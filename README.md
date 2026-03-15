# 𝕃 Theoretical Programming Language Interpreter

A browser-based interpreter for a minimal **theoretical programming language** used to demonstrate fundamental computation concepts such as variable manipulation, conditional jumps, and simple program execution.

The application provides a lightweight **IDE-style interface** for writing and executing programs in the language **L** directly in the browser.

Inspired by Dr. Ronald Fechter. The website can be viewed at the link found below:

https://anthonyvallejo23.github.io/L-Theoretical-Programming-Language/

---

# Overview

The interpreter simulates a simple machine with three classes of variables:

- **X₁, X₂, ...** – input variables provided by the user  
- **Z₁, Z₂, ...** – automatically created local variables  
- **Y** – the output variable  

Programs are written as sequences of instructions that manipulate these variables. Execution proceeds sequentially with optional jumps using labels.

The interface allows users to:

- Write programs
- Execute them step-by-step or continuously
- Monitor variable values
- Observe the current instruction being executed

---

# Language Specification

## Variables

| Variable Type | Description |
|---|---|
| `Xₙ` | Input variables controlled by the user |
| `Zₙ` | Automatically created local variables |
| `Y` | Output variable |

All variables store **non-negative integers**.

---

# Instruction Set

### Increment

```
V <- V + 1
```

Increments variable `V` by one.

Example:

```
X <- X + 1
```

---

### Decrement

```
V <- V - 1
```

Decrements variable `V` by one if the value is greater than zero.

---

### Conditional Jump

```
IF V =/= 0 GOTO L
```

If `V` is non-zero, execution jumps to label `L`.

Example:

```
IF X =/= 0 GOTO A
```

---

### Labels

```
[A]
```

Labels mark positions in the program that can be jumped to.

Example:

```
[A]
X <- X - 1
IF X =/= 0 GOTO A
```

---

# Macro Extensions (Optional)

The interpreter supports optional macro instructions that can be enabled in the interface.

| Macro | Description |
|---|---|
| `GOTO L` | Unconditional jump |
| `V <- 0` | Set variable to zero |
| `V <- V'` | Copy value from another variable |

These macros are disabled by default and must be enabled before program execution.

---

# Example Program

Example loop that decrements `X` until it reaches zero:

```
[A]
X <- X - 1
IF X =/= 0 GOTO A
```

Execution stops once `X` becomes `0`.

---

# Features

### Interactive IDE

- Code editor for writing programs
- Input variable configuration
- Real-time variable display

### Execution Controls

- Run program
- Step through instructions
- Reset and reload program

### Visualization

- Program counter indicator
- Current instruction display
- Variable value tracking

### Additional Functionality

- Dynamic creation of input variables (`+ Add X`)
- Automatic creation of local variables (`Zₙ`)
- Step limit protection (10000 steps)
- Program export to file
- Dark mode support

---

# Execution Model

The interpreter executes programs using a simple control loop:

1. Parse source code
2. Build instruction list and label map
3. Initialize variables
4. Execute instructions sequentially
5. Update program counter
6. Halt when:
   - end of program is reached
   - a label is missing
   - the step limit is exceeded

---

# Project Structure

```
project/
│
├── index.html
│   Frontend interface and editor
│
└── interpreter-backend.js
    Interpreter engine and execution logic
```

### index.html

Responsible for:

- UI layout
- input variable controls
- code editor
- execution controls
- macro configuration
- visualization of variables and program state

### interpreter-backend.js

Implements the interpreter:

- program parsing
- instruction execution
- variable storage
- label resolution
- macro handling
- UI synchronization

---

# Running the Project

No installation is required.

1. Clone the repository

```
git clone https://github.com/yourusername/theoretical-language-interpreter
```

2. Open the file:

```
index.html
```

in any modern web browser.

---

# Limitations

- Maximum execution length: **10000 steps**
- Variables are restricted to **non-negative integers**
- Programs must follow strict syntax rules

---

# AI Assistance

Generative AI tools were used to assist with aspects of development, including documentation drafting, code review, and implementation support during the development process. Final integration, testing, and design decisions were performed by the author.
