<p align="center">
  <img src="public/logo.png" alt="TritonSched Logo" width="120">
</p>

<h1 align="center">TritonSched 1.0.0</h1>

<p align="center">
  Calendar schedule builder and planning tool for UC San Diego students using TSS.
</p>

---

**TritonSched** is a browser extension built to help with course planning and schedule visualization for UC San Diego students using the **Triton Student System (TSS).** 

Inspired by WebReg's old Calendar view, I built **TritonSched** to give students a similar clean, weekly calendar interface, with conflict checking, RMP instructor lookups, and multiple plan views, all inside of TSS itself. It is currently still in development and I'm still making active updates. If you encounter bugs or you have feature ideas, feel free to send feedback directly in the extension in the information (i) section. 

Developed by **Nicole Sutedja.**

---

## ✨ Key Features

- **Automated Network Interception:** Intercepts and normalizes live OData responses as you browse TSS courses.
- **Dynamic Weekly Calendar Matrix:** Displays enrollment sections on a Monday–Friday grid with dynamic time scaling based on early or late course meetings.
- **Color Customization:** Choose the color you'd like the course blocks to be.
- **iCalendar (.ics) & PDF Export:** Export complete quarterly schedules or final exam dates directly to your calendar or as a PDF.
- **Real-Time Conflict Detection:** Identifies and highlights overlapping classes and final exam collisions with visual alert indicators.
- **Multi-Plan Management:** Draft, rename, compare, and switch between multiple schedule options (e.g., Plan A, Plan B).
- **Floating & Resizable Panel:** Provides a fully draggable and resizable overlay window that complements the native TSS interface.
- **Integrated Rate My Professor:** Easily check the ratings of a professor as you plan your classes.

---

## 🛠 Tech Stack

| Component | Technology | Description |
|-----------|------------|-------------|
| Bundler | Vite | High-performance frontend build engine |
| Extension Tooling | `@crxjs/vite-plugin` | Manifest V3 HMR integration |
| Platform | Chrome Extension API | Manifest V3 standards |
| Core Logic | Vanilla JavaScript (ES Modules) | Lightweight DOM manipulation and state management |
| Styling | Modular CSS3 | Custom scoped theme engine |

---

# 🚀 Installation & Setup

## For Users

1. Download the latest release or clone this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer Mode**.
4. Click **Load unpacked**.
5. Select the `dist/` directory (or the project folder if applicable).
6. Navigate to **https://tss.ucsd.edu**.
7. Click the floating **📅 Schedule** launcher in the bottom corner.

---

## For Developers

### Prerequisites

- Node.js **18+**
- npm **9+**

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/tss-schedule-builder.git
cd tss-schedule-builder
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Development Server

Runs Vite with file watching and Hot Module Replacement (HMR).

```bash
npm run dev
```

### 4. Load the Extension

1. Open `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select the generated `dist/` directory
5. Open **https://tss.ucsd.edu**

Changes made inside `src/` will automatically trigger a rebuild and extension reload.

---

## 📄 License

This project is licensed under the MIT License. See the `LICENSE` file for details.