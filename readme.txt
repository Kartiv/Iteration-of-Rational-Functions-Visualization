# Complex Dynamics Visualizer

A web-based interactive tool for simulating the iteration of rational functions and illustrating Julia sets. It features inverse iteration generation, adjustable brush tools, and interactive zooming.

## 🚀 How to Run Locally

Because this application utilizes Web Workers for high-performance rendering, it must be run through a local web server. Opening `index.html` directly from your file explorer will result in CORS/security errors in the browser console.

### Option 1: Using Python (Recommended, usually pre-installed)
If you have Python installed on your machine, you already have a built-in web server.

1. Open your terminal or command prompt (cmd).
2. Navigate to the folder containing your project files:
   `cd path/to/your/folder`
3. Start the Python server:
   * **Windows / Python 3:** `python -m http.server 8000`
   * **Mac/Linux / Python 3:** `python3 -m http.server 8000`
4. Open your web browser and navigate to: **http://localhost:8000**

### Option 2: Using Node.js (npm)
If you are a JavaScript developer and have Node.js installed, you can use `serve` or `http-server`.

1. Open your terminal and navigate to your project folder.
2. Run the `serve` package (no installation required if you use npx):
   `npx serve .`
3. Open your web browser and navigate to the address shown in your terminal (usually **http://localhost:3000**).

---

## 🛠️ Features & Usage

* **Function Inputs:** Define your rational function f(z) = P(z)/Q(z) by entering the numerator and denominator using standard math notation (e.g., `z^2 - 1`).
* **Zooming:** Click the "Zoom" button, then click and drag on the canvas to draw a bounding box. The app will automatically recalculate the Julia set for that specific region. Click "Unzoom" to return to your previous view.
* **Painting / Erasing:** Select the Brush or Eraser tools to manually add or remove points from the grid. Adjust the brush size using the slider.
* **Iteration:** * Click **Start / Reset** to generate the initial grid and calculate the base Julia set.
  * Click **Iterate** to animate the points forward one step through your function.
  * Click **Reverse** to animate the points backward to their previous state.