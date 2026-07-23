# 📅 TSS Schedule Builder

Rebuilds a **Monday–Friday weekly calendar view** for UCSD's Triton Student System (TSS), restoring the visual schedule planning experience previously available in WebReg.

---

## ✨ Features

- 📡 **Automatic OData Interception**
  - Captures course and section information from the `YUCSD_CON_EVENTS` and `_sections` endpoints as you browse TSS.

- 📅 **Weekly Schedule Grid**
  - Displays selected class sections on a clean Monday–Friday calendar.

- ⚠️ **Conflict Detection**
  - Automatically highlights overlapping classes in red and warns about scheduling conflicts.

- 📂 **Multiple Schedule Plans**
  - Create, rename, delete, and switch between multiple schedule drafts (e.g. *Plan A*, *Plan B*).

- 🖱️ **Draggable & Resizable Window**
  - Move or resize the floating schedule planner anywhere on the page.

- 💾 **Persistent Storage**
  - Saves course data, schedule plans, and UI preferences using `chrome.storage.local`.

---

## 🛠 Tech Stack

Built using modern Chrome Extension tooling.

| Technology | Purpose |
|------------|---------|
| Vite | Development server & build tool |
| @crxjs/vite-plugin | Chrome Extension integration |
| Manifest V3 | Chrome Extension framework |
| JavaScript (ES Modules) | Application logic |
| HTML & CSS | User interface |

---

# 🚀 Getting Started

## For Users

If you only want to use the extension:

1. Clone or download this repository.
2. Open Chrome and navigate to:

   ```
   chrome://extensions/
   ```

3. Enable **Developer Mode**.
4. Click **Load unpacked**.
5. Select the project folder (or the `dist/` folder if using a production build).
6. Visit **https://tss.ucsd.edu**.
7. Open any course's **Class Sections** page.
8. Click the floating **📅 Schedule** button to begin planning.

---

## For Developers

### Prerequisites

- Node.js **v18+**
- npm

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/tss-schedule-builder.git
cd tss-schedule-builder
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Development Mode

```bash
npm run dev
```

Vite and CRXJS will:

- build the extension
- watch for file changes
- output to the `dist/` folder
- enable Hot Module Replacement (HMR)

### 4. Load the Extension

Open:

```
chrome://extensions/
```

Then:

1. Enable **Developer Mode**
2. Click **Load unpacked**
3. Select the generated `dist/` folder

After loading the development build:

- Edit files such as:
  - `content.js`
  - `inject.js`
  - `styles.css`

Changes will automatically rebuild and reload the extension.

In most cases, you won't need to reload the extension from `chrome://extensions/`, allowing you to keep your current TSS session while developing.

---

## 📦 Production Build

To generate an optimized production build:

```bash
npm run build
```

The compiled extension will be available in:

```
dist/
```

This folder is ready to distribute, zip, or publish.

---

## 📁 Project Structure

```text
tss-schedule-builder/
├── src/
│   ├── content.js
│   ├── inject.js
│   ├── styles.css
│   └── ...
├── public/
├── dist/
├── manifest.json
├── package.json
└── README.md
```

---

## 💡 Future Improvements

- Import/export schedule plans
- Color customization
- Dark mode
- Calendar (.ics) export
- Better conflict visualization
- Support for additional TSS views