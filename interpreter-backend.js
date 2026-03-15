// interpreter-backend.js – core engine for L
// expected to be loaded after the frontend DOM is ready

(function () {
    // ----- constants -----
    const MAX_STEPS = 10000;

    // ----- central state -----
    let sourceLines = [];               // raw lines (string)
    let parsedInstructions = [];        // array of {lineNum, origLine, label, op, varName, targetLabel?, srcVar?}
    let labelToLine = new Map();        // label string -> line index (0‑based) – supports any label

    // variable stores
    let X = new Map();    // key: 'X1','X2'...   (X internally stored as 'X1')
    let Z = new Map();    // key: 'Z1','Z2'...
    let Y = 0;

    // execution pointers
    let PC = 0;                  // index into parsedInstructions (next to execute)
    let stepsExecuted = 0;
    let halted = false;
    let haltReason = '';

    // macro switches (default all false)
    let macroGoto = false;
    let macroSetZero = false;
    let macroCopy = false;

    // ----- grab UI elements (exported from frontend) -----
    const codeArea = document.getElementById('codeArea');
    const yDisplay = document.getElementById('y-display');
    const pcLabel = document.getElementById('pcLabel');
    const messageSpan = document.getElementById('message');
    const warningMsgSpan = document.getElementById('warningMsg');
    const stepCounterSpan = document.getElementById('stepCounterDisplay');
    const xContainer = document.getElementById('x-inputs-container');
    const lineHighlightSpan = document.getElementById('lineHighlight');
    const zDisplayContainer = document.getElementById('z-display-container');

    // macro checkboxes
    const macroGotoCheck = document.getElementById('macroGoto');
    const macroSetZeroCheck = document.getElementById('macroSetZero');
    const macroCopyCheck = document.getElementById('macroCopy');

    // collapsible macro panel elements
    const macroHeader = document.getElementById('macroHeader');
    const macroContent = document.getElementById('macroContent');
    const macroArrow = document.getElementById('macroArrow');

    // dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');

    // save button
    const saveBtn = document.getElementById('saveBtn');

    // ---------- save to file ----------
    function saveToFile() {
        const code = codeArea.value;
        const macroStates = {
            goto: macroGotoCheck.checked,
            setZero: macroSetZeroCheck.checked,
            copy: macroCopyCheck.checked
        };

        const content = code;

        // Create blob and download
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `L-Program.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Brief feedback
        alert('Program saved to file');
    }

    // ---------- helper: rebuild X inputs from X map ----------
    function rebuildXInputs() {
        const xNumbers = new Set();
        for (let key of X.keys()) {
            if (key.startsWith('X')) {
                const num = parseInt(key.substring(1)) || 1;
                xNumbers.add(num);
            }
        }
        if (xNumbers.size === 0) xNumbers.add(1);

        const sorted = Array.from(xNumbers).sort((a, b) => a - b);
        let html = '';
        sorted.forEach(num => {
            const key = 'X' + num;
            const val = X.get(key) ?? 0;
            html += `<div class="x-field"><label>X${num}</label><input type="number" data-var="${key}" value="${val}" min="0" step="1"></div>`;
        });
        xContainer.innerHTML = html;

        // attach listeners to update X map on manual change
        document.querySelectorAll('.x-field input[data-var]').forEach(inp => {
            inp.addEventListener('input', function (e) {
                const varKey = this.dataset.var;
                let newVal = parseInt(this.value, 10);
                if (isNaN(newVal) || newVal < 0) newVal = 0;
                X.set(varKey, newVal);
                this.value = newVal;
            });
        });
    }

    // ---------- rebuild Z display (badges) ----------
    function rebuildZDisplay() {
        if (Z.size === 0) {
            zDisplayContainer.innerHTML = '<span style="color:--text-color-descriptor;">(none defined yet)</span>';
            return;
        }

        // Sort Z keys numerically
        const zKeys = Array.from(Z.keys()).sort((a, b) => {
            const numA = parseInt(a.substring(1)) || 0;
            const numB = parseInt(b.substring(1)) || 0;
            return numA - numB;
        });

        let html = '';
        zKeys.forEach(key => {
            const val = Z.get(key) ?? 0;
            html += `<div class="z-badge">${key} <span>${val}</span></div>`;
        });
        zDisplayContainer.innerHTML = html;
    }

    // ---------- read current X from input fields into map ----------
    function updateXmapFromInputs() {
        const inputs = document.querySelectorAll('.x-field input[data-var]');
        inputs.forEach(inp => {
            const key = inp.dataset.var;
            const val = parseInt(inp.value, 10);
            X.set(key, isNaN(val) ? 0 : Math.max(0, val));
        });
    }

    // ---------- variable normalization ----------
    function normalizeVar(v) {
        if (!v) return v;
        v = v.toUpperCase();
        if (v === 'X') return 'X1';
        if (v === 'Z') return 'Z1';
        if (v === 'Y') return 'Y';
        return v;   // X2, Z3 etc
    }

    // normalize label: we keep as-is (any alphanumeric, but common pattern A1, B2, ...)
    function normalizeLabel(l) {
        if (!l) return l;
        return l.toUpperCase();
    }

    // ---------- variable access ----------
    function getVar(name) {
        if (name === 'Y') return Y;
        if (name.startsWith('Z')) return Z.get(name) ?? 0;
        if (name.startsWith('X')) return X.get(name) ?? 0;
        return 0;
    }

    function setVar(name, val) {
        if (val < 0) val = 0;
        if (name === 'Y') {
            Y = val;
        } else if (name.startsWith('Z')) {
            Z.set(name, val);
            rebuildZDisplay(); // Update Z display whenever a Z changes
        } else if (name.startsWith('X')) {
            X.set(name, val);
        }
    }

    // ---------- parsing lines (with macro support and – for decrement) ----------
    function parseLines(lines) {
        const instructions = [];
        const labelMap = new Map();

        lines.forEach((rawLine, idx) => {
            let line = rawLine.trim();
            if (line.includes(';')) line = line.substring(0, line.indexOf(';')).trim();
            if (line.startsWith('//')) line = '';

            if (line === '') {
                instructions.push(null);
                return;
            }

            let label = null;
            // label pattern: any word inside brackets, e.g. [A1], [LOOP], [X99]
            const labelMatch = line.match(/^\s*\[([A-Za-z][A-Za-z0-9]*)\]\s*(.*)/);
            if (labelMatch) {
                label = normalizeLabel(labelMatch[1]);
                line = labelMatch[2].trim();
            }

            let op = null;
            let varName = null;
            let targetLabel = null;
            let srcVar = null; // for copy operation

            // 1. IF ... GOTO ... (always enabled)
            const ifMatch = line.match(/^IF\s+([A-Z][0-9]*)\s*(!=|=\/=|≠)\s*0\s+(GOTO|GO\s+TO)\s+([A-Za-z][A-Za-z0-9]*)$/i);
            if (ifMatch) {
                op = 'IF';
                varName = normalizeVar(ifMatch[1]);
                targetLabel = normalizeLabel(ifMatch[4]);
            }
            // 2. GOTO / GO TO (macro, only if enabled)
            else if (macroGoto) {
                const gotoMatch = line.match(/^(GOTO|GO\s+TO)\s+([A-Za-z][A-Za-z0-9]*)$/i);
                if (gotoMatch) {
                    op = 'GOTO';
                    targetLabel = normalizeLabel(gotoMatch[2]);
                }
            }

            // 3. V <- 0  (macro set zero)
            if (!op && macroSetZero) {
                const setZeroMatch = line.match(/^([A-Z][0-9]*)\s*(<-|←|<)\s*0$/);
                if (setZeroMatch) {
                    op = 'SETZERO';
                    varName = normalizeVar(setZeroMatch[1]);
                }
            }

            // 4. V <- V'  (macro copy)
            if (!op && macroCopy) {
                const copyMatch = line.match(/^([A-Z][0-9]*)\s*(<-|←|<)\s*([A-Z][0-9]*)$/);
                if (copyMatch && copyMatch[1] !== copyMatch[3]) { // avoid self-copy but we'll allow it as no-op
                    op = 'COPY';
                    varName = normalizeVar(copyMatch[1]);
                    srcVar = normalizeVar(copyMatch[3]);
                }
            }

            // 5. Regular inc/dec (always enabled) - supports both - and – for decrement
            if (!op) {
                // Increment: +1
                const incMatch = line.match(/^([A-Z][0-9]*)\s*(<-|←|<)\s*\1\s*\+\s*1$/);
                // Decrement: -1 or –1 (en dash)
                const decMatch = line.match(/^([A-Z][0-9]*)\s*(<-|←|<)\s*\1\s*[-–]\s*1$/);
                if (incMatch) {
                    op = 'INC';
                    varName = normalizeVar(incMatch[1]);
                } else if (decMatch) {
                    op = 'DEC';
                    varName = normalizeVar(decMatch[1]);
                }
            }

            if (op) {
                const instr = {
                    lineNum: idx,
                    origLine: rawLine,
                    label: label,
                    op: op,
                    varName: varName,
                    targetLabel: targetLabel,
                    srcVar: srcVar
                };
                instructions.push(instr);
                if (label) {
                    if (labelMap.has(label)) console.warn(`duplicate label ${label}`);
                    labelMap.set(label, instructions.length - 1);
                }
            } else {
                instructions.push(null);
            }
        });
        return { instructions, labelMap };
    }

    // ---------- scan for missing X variables and add them ----------
    function scanVariablesAndAddMissingX(instructions) {
        for (let instr of instructions) {
            if (instr && instr.varName && instr.varName.startsWith('X')) {
                if (!X.has(instr.varName)) {
                    X.set(instr.varName, 0);
                }
            }
            if (instr && instr.srcVar && instr.srcVar.startsWith('X')) {
                if (!X.has(instr.srcVar)) {
                    X.set(instr.srcVar, 0);
                }
            }
        }
        if (X.size === 0) X.set('X1', 0);
    }

    // ---------- full reset (load from editor) ----------
    function fullReset(keepX = true) {
        if (keepX) {
            updateXmapFromInputs();
        } else {
            X.clear();
        }

        const src = codeArea.value;
        sourceLines = src.split(/\r?\n/);
        const parseResult = parseLines(sourceLines);
        parsedInstructions = parseResult.instructions;
        labelToLine = parseResult.labelMap;

        Z.clear();
        Y = 0;

        scanVariablesAndAddMissingX(parsedInstructions);
        rebuildXInputs();
        rebuildZDisplay();

        PC = 0;
        stepsExecuted = 0;
        halted = false;
        haltReason = 'reset / ready';
        updateStatusAndY();
    }

    // ---------- get current line text for display ----------
    function getCurrentLineText() {
        if (halted || PC >= parsedInstructions.length) return '—';

        // Skip null instructions
        let currentPC = PC;
        while (currentPC < parsedInstructions.length && parsedInstructions[currentPC] === null) {
            currentPC++;
        }
        if (currentPC >= parsedInstructions.length) return '—';

        const instr = parsedInstructions[currentPC];
        if (!instr) return '—';

        // Return the original line, trimmed
        return instr.origLine.trim() || '—';
    }

    // ---------- step one instruction ----------
    function stepOnce() {
        if (halted) return { halted: true, reason: haltReason };
        if (PC >= parsedInstructions.length) {
            halted = true;
            haltReason = 'past last instruction';
            updateStatusAndY();
            return { halted: true, reason: haltReason };
        }
        if (stepsExecuted >= MAX_STEPS) {
            halted = true;
            haltReason = `step limit (${MAX_STEPS}) reached`;
            alert(`WARNING. Step limit of ${MAX_STEPS} reached. Execution aborted early.`);
            updateStatusAndY();
            return { halted: true, reason: haltReason };
        }

        // skip null (empty/unrecognised) lines
        while (PC < parsedInstructions.length && parsedInstructions[PC] === null) {
            PC++;
        }
        if (PC >= parsedInstructions.length) {
            halted = true;
            haltReason = 'past last instruction (after skipping blanks)';
            updateStatusAndY();
            return { halted: true, reason: haltReason };
        }

        const instr = parsedInstructions[PC];
        let advancePC = true;

        switch (instr.op) {
            case 'INC':
                const curInc = getVar(instr.varName);
                setVar(instr.varName, curInc + 1);
                break;

            case 'DEC':
                const curDec = getVar(instr.varName);
                if (curDec > 0) setVar(instr.varName, curDec - 1);
                break;

            case 'IF':
                const val = getVar(instr.varName);
                if (val !== 0) {
                    const targetIdx = labelToLine.get(instr.targetLabel);
                    if (targetIdx === undefined) {
                        halted = true;
                        haltReason = `missing label [${instr.targetLabel}] from GOTO`;
                        updateStatusAndY();
                        return { halted: true, reason: haltReason };
                    }
                    PC = targetIdx;
                    advancePC = false;
                }
                break;

            case 'GOTO':
                const targetIdx = labelToLine.get(instr.targetLabel);
                if (targetIdx === undefined) {
                    halted = true;
                    haltReason = `missing label [${instr.targetLabel}] from GOTO`;
                    updateStatusAndY();
                    return { halted: true, reason: haltReason };
                }
                PC = targetIdx;
                advancePC = false;
                break;

            case 'SETZERO':
                setVar(instr.varName, 0);
                break;

            case 'COPY':
                const srcVal = getVar(instr.srcVar);
                setVar(instr.varName, srcVal);
                break;
        }

        if (advancePC) {
            PC++;
        }

        stepsExecuted++;
        if (PC >= parsedInstructions.length) {
            halted = true;
            haltReason = 'past last instruction';
        }

        updateStatusAndY();
        return { halted, reason: haltReason };
    }

    // ---------- refresh UI ----------
    function updateStatusAndY() {
        yDisplay.textContent = Y;
        pcLabel.textContent = (halted ? '⏹' : '▶') + ' PC: ' + (PC < parsedInstructions.length ? PC : 'end');
        stepCounterSpan.textContent = `steps: ${stepsExecuted} / ${MAX_STEPS}`;

        if (halted) {
            messageSpan.innerHTML = `⏸ halted: ${haltReason}`;
        } else {
            messageSpan.innerHTML = `⏵ running (next instr #${PC})`;
        }
        warningMsgSpan.textContent = halted ? haltReason : '';

        // Show current line content
        if (!halted && PC < parsedInstructions.length) {
            const lineText = getCurrentLineText();
            lineHighlightSpan.textContent = `current line: ${lineText}`;
        } else {
            lineHighlightSpan.textContent = `current line: —`;
        }

        // sync X fields with current X map values
        rebuildXInputs();
        // Z display is updated via setVar, but call once more for safety
        rebuildZDisplay();
    }

    // ---------- macro checkbox change handlers ----------
    function updateMacrosFromCheckboxes() {
        macroGoto = macroGotoCheck.checked;
        macroSetZero = macroSetZeroCheck.checked;
        macroCopy = macroCopyCheck.checked;
        // No auto-reset - user must click reset to apply new macro settings
    }

    // ---------- collapsible macro panel ----------
    function toggleMacroPanel() {
        const isExpanded = macroContent.classList.contains('expanded');
        if (isExpanded) {
            macroContent.classList.remove('expanded');
            macroArrow.classList.remove('expanded');
        } else {
            macroContent.classList.add('expanded');
            macroArrow.classList.add('expanded');
        }
    }

    // ---------- attach event listeners (UI bindings) ----------
    document.getElementById('resetProgramBtn').addEventListener('click', () => {
        updateMacrosFromCheckboxes(); // read latest macro settings
        fullReset(true);
    });

    document.getElementById('stepBtn').addEventListener('click', () => {
        if (!halted) {
            stepOnce();
        } else {
            alert('Program halted. Press reset to reload.');
        }
    });

    document.getElementById('runBtn').addEventListener('click', () => {
        if (halted) {
            if (stepsExecuted < MAX_STEPS) {
                alert('Program halted. Press reset to reload.');
            }
            updateMacrosFromCheckboxes();
            fullReset(true);
        }

        let reachedLimit = false;

        while (!halted && stepsExecuted < MAX_STEPS) {
            stepOnce();
        }

        if (stepsExecuted >= MAX_STEPS) {
            reachedLimit = true;
        }

        updateStatusAndY();

        if (reachedLimit) {
        alert(`WARNING. Step limit of ${MAX_STEPS} reached. Execution aborted early.`);
        }
    });

    // ---------- Save button ----------
    saveBtn.addEventListener('click', saveToFile);

    // ---------- Add new X variable button ----------
    document.getElementById('addXBtn').addEventListener('click', () => {
        let max = 0;
        for (let key of X.keys()) {
            if (key.startsWith('X')) {
                const num = parseInt(key.substring(1));
                if (!isNaN(num) && num > max) max = num;
            }
        }
        const newNum = max + 1;
        const newKey = 'X' + newNum;
        if (!X.has(newKey)) {
            X.set(newKey, 0);
        }
        rebuildXInputs();
    });

    // Individual macro checkboxes - just update internal state
    [macroGotoCheck, macroSetZeroCheck, macroCopyCheck].forEach(cb => {
        cb.addEventListener('change', updateMacrosFromCheckboxes);
    });

    // Collapsible macro panel toggle
    macroHeader.addEventListener('click', toggleMacroPanel);

    // Set up dark mode toggle using the global function
    if (darkModeToggle && window.toggleDarkMode) {
        darkModeToggle.addEventListener('click', window.toggleDarkMode);
    }

    // initial load
    window.addEventListener('load', () => {
        // default X values
        X.set('X1', 2);
        X.set('X2', 0);
        X.set('X3', 0);

        // set default macros (all off)
        macroGotoCheck.checked = false;
        macroSetZeroCheck.checked = false;
        macroCopyCheck.checked = false;
        updateMacrosFromCheckboxes();

        rebuildXInputs();
        rebuildZDisplay();
        fullReset(true);

        // Start with macro panel collapsed
        macroContent.classList.add('collapsed');
        macroArrow.classList.add('collapsed');
    });

    // expose some internals if needed (debug)
    window.__toyDebug = { getState: () => ({ X, Z, Y, PC, halted, stepsExecuted, macros: { macroGoto, macroSetZero, macroCopy } }) };
})();
