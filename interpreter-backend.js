// interpreter-backend.js – core engine for toy assembly
// expected to be loaded after the frontend DOM is ready

(function() {
    // ----- constants -----
    const MAX_STEPS = 1000;

    // ----- central state -----
    let sourceLines = [];               // raw lines (string)
    let parsedInstructions = [];         // array of {lineNum, origLine, label, op, varName, targetLabel?}
    let labelToLine = new Map();         // label string -> line index (0‑based)

    // variable stores
    let X = new Map();    // key: 'X1','X2'...   (X internally stored as 'X1')
    let Z = new Map();    // key: 'Z1','Z2'...
    let Y = 0;

    // execution pointers
    let PC = 0;                  // index into parsedInstructions (next to execute)
    let stepsExecuted = 0;
    let halted = false;
    let haltReason = '';

    // ----- grab UI elements (exported from frontend) -----
    const codeArea = document.getElementById('codeArea');
    const yDisplay = document.getElementById('y-display');
    const pcLabel = document.getElementById('pcLabel');
    const messageSpan = document.getElementById('message');
    const warningMsgSpan = document.getElementById('warningMsg');
    const stepCounterSpan = document.getElementById('stepCounterDisplay');
    const xContainer = document.getElementById('x-inputs-container');

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

        const sorted = Array.from(xNumbers).sort((a,b)=>a-b);
        let html = '';
        sorted.forEach(num => {
            const key = 'X' + num;
            const val = X.get(key) ?? 0;
            html += `<div class="x-field"><label>X${num}</label><input type="number" data-var="${key}" value="${val}" min="0" step="1"></div>`;
        });
        xContainer.innerHTML = html;

        // attach listeners to update X map on manual change
        document.querySelectorAll('.x-field input[data-var]').forEach(inp => {
            inp.addEventListener('input', function(e) {
                const varKey = this.dataset.var;
                let newVal = parseInt(this.value, 10);
                if (isNaN(newVal) || newVal < 0) newVal = 0;
                X.set(varKey, newVal);
                this.value = newVal;
            });
        });
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

    // ---------- reset locals (Z, Y) ----------
    function resetLocalsAndY() {
        Z.clear();
        Y = 0;
        updateYdisplay();
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

    function normalizeLabel(l) {
        if (!l) return l;
        l = l.toUpperCase();
        if (l === 'A') return 'A1';
        if (l === 'B') return 'B1';
        if (l === 'C') return 'C1';
        if (l === 'D') return 'D1';
        if (l === 'E') return 'E1';
        return l;
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
        if (name === 'Y') { Y = val; }
        else if (name.startsWith('Z')) { Z.set(name, val); }
        else if (name.startsWith('X')) { X.set(name, val); }
    }

    // ---------- parsing lines ----------
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
            const labelMatch = line.match(/^\s*\[([A-E][1-9]?)\]\s*(.*)/);
            if (labelMatch) {
                label = normalizeLabel(labelMatch[1]);
                line = labelMatch[2].trim();
            }

            let op = null;
            let varName = null;
            let targetLabel = null;

            const ifMatch = line.match(/^IF\s+([A-Z][0-9]*)\s*(!=|=\/=|≠)\s*0\s+GOTO\s+([A-E][1-9]?)$/i);
            if (ifMatch) {
                op = 'IF';
                varName = normalizeVar(ifMatch[1]);
                targetLabel = normalizeLabel(ifMatch[3]);
            } else {
                const incMatch = line.match(/^([A-Z][0-9]*)\s*(<|←)\s*\1\s*\+\s*1$/);
                const decMatch = line.match(/^([A-Z][0-9]*)\s*(<|←)\s*\1\s*-\s*1$/);
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
                    targetLabel: targetLabel
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

        PC = 0;
        stepsExecuted = 0;
        halted = false;
        haltReason = 'reset / ready';
        updateStatusAndY();
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

        if (instr.op === 'INC') {
            const cur = getVar(instr.varName);
            setVar(instr.varName, cur + 1);
        } else if (instr.op === 'DEC') {
            const cur = getVar(instr.varName);
            if (cur > 0) setVar(instr.varName, cur - 1);
        } else if (instr.op === 'IF') {
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

        // sync X fields with current X map values
        rebuildXInputs();
    }

    function updateYdisplay() {
        yDisplay.textContent = Y;
    }

    // ---------- attach event listeners (UI bindings) ----------
    document.getElementById('resetProgramBtn').addEventListener('click', () => {
        fullReset(true);
    });

    document.getElementById('clearStateBtn').addEventListener('click', () => {
        updateXmapFromInputs();
        resetLocalsAndY();
        updateStatusAndY();
        rebuildXInputs();
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
            fullReset(true);
        }
        while (!halted && stepsExecuted < MAX_STEPS) {
            stepOnce();
        }
        updateStatusAndY();
    });

    // initial load
    window.addEventListener('load', () => {
        // some default X values
        X.set('X1', 2);
        X.set('X2', 0);
        X.set('X3', 0);
        rebuildXInputs();
        fullReset(true);
    });

    // expose some internals if needed (debug)
    window.__toyDebug = { getState: () => ({ X, Z, Y, PC, halted, stepsExecuted }) };
})();
