document.addEventListener('DOMContentLoaded', () => {
    // --- 1. Setup & Configuration ---
    const mainCanvas = document.getElementById('main-canvas'); 
    const foreCanvas = document.getElementById('foreground-canvas'); 
    const ctxMain = mainCanvas.getContext('2d');
    const ctxFore = foreCanvas.getContext('2d');
    
    const canvasWidth = mainCanvas.width;
    const canvasHeight = mainCanvas.height;
    const canvasAspectRatio = canvasWidth / canvasHeight;

    // Inputs
    const numInput = document.getElementById('numerator');
    const denInput = document.getElementById('denominator');
    const xMinInput = document.getElementById('xMin');
    const xMaxInput = document.getElementById('xMax');
    const yMinInput = document.getElementById('yMin');
    const yMaxInput = document.getElementById('yMax');
    const statusIndicator = document.getElementById('status-indicator');

    // Buttons
    const startBtn = document.getElementById('start-reset');
    const iterateBtn = document.getElementById('iterate');
    const reverseBtn = document.getElementById('reverse');
    const unzoomBtn = document.getElementById('unzoom-btn'); 

    // Tool Elements
    const canvasContainer = document.getElementById('canvas-container');
    const brushToolBtn = document.getElementById('brush-tool');
    const eraserToolBtn = document.getElementById('eraser-tool');
    const zoomToolBtn = document.getElementById('zoom-tool'); 
    const brushSizeSlider = document.getElementById('brush-size');
    const brushSizeLabel = document.getElementById('brush-size-label');
    const zoomRect = document.getElementById('zoom-rect'); 
    
    // Overlay Controls
    const toggleEquiBtn = document.getElementById('toggle-equi');
    const toggleRaysBtn = document.getElementById('toggle-rays');
    let showEqui = false;
    let showRays = false;

    // --- Configuration Variables ---
    const GRID_DIM = 200; 
    const ANIMATION_DURATION = 1000; 
    
    // --- 2. State Management ---
    let view = null; 
    let rationalFunc = null;       
    let gridPoints = [];           
    let criticalPoints = []; 
    let brushedPoints = []; 
    let gridHistory = [];
    let critHistory = []; 
    let brushHistory = []; 
    let viewHistory = []; 
    let animationFrameId = null;   
    let isAnimating = false;
    let juliaWorker = null;
    
    // Tool state
    let currentTool = 'none'; 
    let isPainting = false;
    let isZooming = false; 
    let zoomStartCoords = null; 

    // --- 3. Core Logic ---

    function startReset() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        isAnimating = false;

        const xMin = parseFloat(xMinInput.value);
        const xMax = parseFloat(xMaxInput.value);
        const yMin = parseFloat(yMinInput.value);
        const yMax = parseFloat(yMaxInput.value);

        if (isNaN(xMin) || isNaN(xMax) || isNaN(yMin) || isNaN(yMax) || xMin >= xMax || yMin >= yMax) {
            console.error("Invalid view bounds.");
            return;
        }
        view = { xMin, xMax, yMin, yMax };

        try {
            const numStr = numInput.value;
            const denStr = denInput.value;
            const numNode = math.parse(numStr);
            const denNode = math.parse(denStr);
            rationalFunc = (z) => {
                const scope = { z: z };
                return math.divide(numNode.evaluate(scope), denNode.evaluate(scope));
            };
            rationalFunc(math.complex(1, 1));
        } catch (e) {
            console.error("Error parsing functions:", e.message);
            return;
        }

        ctxMain.fillStyle = 'black';
        ctxMain.fillRect(0, 0, canvasWidth, canvasHeight);
        ctxFore.clearRect(0, 0, canvasWidth, canvasHeight);
        statusIndicator.classList.remove('hidden');
        statusIndicator.textContent = 'Generating Julia Set...';
        statusIndicator.style.color = 'white';
        
        if (juliaWorker) {
            juliaWorker.terminate();
        }
        juliaWorker = new Worker('julia-worker.js');

        juliaWorker.onerror = (err) => {
            console.error("Error from worker:", err.message, "at", err.filename, ":", err.lineno);
            statusIndicator.textContent = 'Error! Check console.';
            statusIndicator.style.color = '#ff8a8a';
            err.preventDefault(); 
        };

        juliaWorker.postMessage({
            numStr: numInput.value,
            denStr: denInput.value,
            view: view, 
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight
        });

        criticalPoints = [];
        brushedPoints = []; 
        
        juliaWorker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'status') {
                statusIndicator.textContent = payload; 
            } 
            else if (type === 'criticalPoints') {
                criticalPoints = payload.points.map(p => math.complex(p.re, p.im));
                critHistory = [criticalPoints]; 
                drawSpecialPoints(criticalPoints, 'red', 5); 
            }
            else if (type === 'chunk') {
                drawJuliaSetChunk(payload.points);
            }
            else if (type === 'complete') {
                statusIndicator.textContent = 'Julia Set (Complete)';
                setTimeout(() => statusIndicator.classList.add('hidden'), 3000);
                
                // Once complete, request overlays if they are toggled on
                if (showEqui || showRays) {
                    requestOverlays();
                }
            }
            else if (type === 'overlayData') {
                const imageData = new ImageData(payload, canvasWidth, canvasHeight);
                ctxFore.clearRect(0, 0, canvasWidth, canvasHeight);
                ctxFore.putImageData(imageData, 0, 0);
                
                if (gridHistory.length > 0) drawGrid(gridHistory[gridHistory.length - 1]);
                if (brushHistory.length > 0) drawBrushedPoints(brushHistory[brushHistory.length - 1], 'yellow');
                
                statusIndicator.classList.add('hidden');
            }
            else if (type === 'result' && payload.error) {
                console.error('Error from Julia set worker:', payload.error);
                statusIndicator.textContent = 'Error! Check console.';
                statusIndicator.style.color = '#ff8a8a';
            }
        };

        gridPoints = [];
        const dx = (view.xMax - view.xMin) / (GRID_DIM - 1);
        const dy = (view.yMax - view.yMin) / (GRID_DIM - 1);
        for (let i = 0; i < GRID_DIM; i++) {
            for (let j = 0; j < GRID_DIM; j++) {
                gridPoints.push(math.complex(view.xMin + i * dx, view.yMin + j * dy));
            }
        }
        
        gridHistory = [gridPoints];
        critHistory = [criticalPoints]; 
        brushHistory = [brushedPoints]; 

        drawGrid(gridPoints);
        
        isPainting = false;
        isZooming = false;
        zoomStartCoords = null;
        zoomRect.style.display = 'none';
    }
    
    function requestOverlays() {
        if (!juliaWorker || (!showEqui && !showRays)) {
            ctxFore.clearRect(0, 0, canvasWidth, canvasHeight);
            if (gridHistory.length > 0) drawGrid(gridHistory[gridHistory.length - 1]);
            if (brushHistory.length > 0) drawBrushedPoints(brushHistory[brushHistory.length - 1], 'yellow');
            return;
        }
        
        statusIndicator.textContent = 'Calculating Dynamics...';
        statusIndicator.classList.remove('hidden');

        juliaWorker.postMessage({
            type: 'calculateOverlays',
            view: view,
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
            showEqui: showEqui,
            showRays: showRays
        });
    }

    function animateStep(isReverse = false) {
        if (isAnimating) return; 
        if (isReverse && (gridHistory.length < 2 || critHistory.length < 2 || brushHistory.length < 2)) {
            console.log("No history to reverse to.");
            return;
        }

        let startGrid, endGrid;
        let startCrits, endCrits; 
        let startBrush, endBrush; 

        if (isReverse) {
            endGrid = gridHistory.pop(); 
            startGrid = gridHistory[gridHistory.length - 1]; 
            [startGrid, endGrid] = [endGrid, startGrid];

            endCrits = critHistory.pop();
            startCrits = critHistory[critHistory.length - 1];
            [startCrits, endCrits] = [endCrits, startCrits];

            endBrush = brushHistory.pop();
            startBrush = brushHistory[brushHistory.length - 1];
            [startBrush, endBrush] = [endBrush, startBrush];

        } else {
            startGrid = gridHistory[gridHistory.length - 1];
            startCrits = critHistory[critHistory.length - 1];
            startBrush = brushHistory[brushHistory.length - 1]; 
            
            try {
                endGrid = startGrid.map(rationalFunc);
                endCrits = startCrits.map(rationalFunc); 
                endBrush = startBrush.map(rationalFunc); 
            } catch (e) {
                console.error("Error during iteration:", e.message);
                return;
            }
            gridHistory.push(endGrid);
            critHistory.push(endCrits); 
            brushHistory.push(endBrush); 
        }

        let startTime = null;
        isAnimating = true;

        const animationLoop = (timestamp) => {
            if (!startTime) startTime = timestamp;
            let progress = (timestamp - startTime) / ANIMATION_DURATION;
            progress = Math.min(progress, 1);

            const t = cubicEase(progress);
            
            const interpolatedGrid = interpolateGrid(startGrid, endGrid, t);
            const interpolatedCrits = interpolateGrid(startCrits, endCrits, t); 
            const interpolatedBrush = interpolateGrid(startBrush, endBrush, t); 

            ctxFore.clearRect(0, 0, canvasWidth, canvasHeight);
            
            // Note: If animating, we temporarily hide overlays for performance
            drawGrid(interpolatedGrid, 'rgba(255, 255, 255, 0.7)');
            drawBrushedPoints(interpolatedBrush, 'rgba(255, 255, 0, 0.7)'); 
            drawSpecialPoints(interpolatedCrits, 'rgba(255, 0, 0, 0.7)', 5); 

            if (progress < 1) {
                animationFrameId = requestAnimationFrame(animationLoop);
            } else {
                isAnimating = false;
                animationFrameId = null;
                ctxFore.clearRect(0, 0, canvasWidth, canvasHeight);
                drawGrid(endGrid);
                drawBrushedPoints(endBrush); 
                drawSpecialPoints(endCrits, 'red', 5); 
                
                // Re-request overlays after animation completes
                if (showEqui || showRays) {
                    requestOverlays();
                }
            }
        };

        animationFrameId = requestAnimationFrame(animationLoop);
    }
    
    function drawJuliaSetChunk(points) {
        ctxMain.fillStyle = 'rgba(255, 255, 255, 0.6)'; 
        const pointSize = 2; 
        for (const [px, py] of points) {
            ctxMain.fillRect(px, py, pointSize, pointSize);
        }
    }
    
    function drawGrid(points, color = 'white') {
        ctxFore.fillStyle = color;
        const pointSize = 2; 
        for (const z of points) {
            const [px, py] = mapComplexToPixel(z); 
            if (px >= 0 && px < canvasWidth && py >= 0 && py < canvasHeight) {
                ctxFore.fillRect(px, py, pointSize, pointSize);
            }
        }
    }

    function drawBrushedPoints(points, color = 'yellow') {
        ctxFore.fillStyle = color;
        const pointSize = 2; 
        for (const z of points) {
            const [px, py] = mapComplexToPixel(z); 
            if (px >= 0 && px < canvasWidth && py >= 0 && py < canvasHeight) {
                ctxFore.fillRect(px, py, pointSize, pointSize);
            }
        }
    }

    function drawSpecialPoints(points, color, radius) {
        ctxFore.fillStyle = color;
        for (const z of points) {
            const [px, py] = mapComplexToPixel(z);
            ctxFore.beginPath();
            ctxFore.arc(px, py, radius, 0, 2 * Math.PI);
            ctxFore.fill();
        }
    }

    function interpolateGrid(gridA, gridB, t) {
        if (!gridA || !gridB) return []; 
        return gridA.map((zA, i) => {
            const zB = gridB[i];
            if (!zB) return zA; 
            return math.add(zA, math.multiply(math.subtract(zB, zA), t));
        });
    }

    function cubicEase(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function mapComplexToPixel(z) {
        const x = ((z.re - view.xMin) / (view.xMax - view.xMin)) * canvasWidth;
        const y = ((view.yMax - z.im) / (view.yMax - view.yMin)) * canvasHeight; 
        return [x, y];
    }

    function mapPixelToComplex(px, py) {
        const re = view.xMin + (px / canvasWidth) * (view.xMax - view.xMin);
        const im = view.yMax - (py / canvasHeight) * (view.yMax - view.yMin); 
        return math.complex(re, im);
    }

    function paint(mouseX, mouseY) {
        if (currentTool !== 'brush' && currentTool !== 'eraser') return;
        const brushSize = parseFloat(brushSizeSlider.value);

        const currentGrid = gridHistory[gridHistory.length - 1];
        const currentBrush = brushHistory[brushHistory.length - 1];

        if (currentTool === 'brush') {
            for (let i = currentGrid.length - 1; i >= 0; i--) {
                const z = currentGrid[i];
                const [px, py] = mapComplexToPixel(z);
                const dist = Math.sqrt(Math.pow(px - mouseX, 2) + Math.pow(py - mouseY, 2));

                if (dist < brushSize) {
                    const [point] = currentGrid.splice(i, 1); 
                    currentBrush.push(point); 
                }
            }
        } else if (currentTool === 'eraser') {
            for (let i = currentBrush.length - 1; i >= 0; i--) {
                const z = currentBrush[i];
                const [px, py] = mapComplexToPixel(z);
                const dist = Math.sqrt(Math.pow(px - mouseX, 2) + Math.pow(py - mouseY, 2));

                if (dist < brushSize) {
                    const [point] = currentBrush.splice(i, 1); 
                    currentGrid.push(point); 
                }
            }
        }

        ctxFore.clearRect(0, 0, canvasWidth, canvasHeight);
        
        // Redraw overlays manually during paint to prevent flickering
        if (showEqui || showRays) {
            requestOverlays();
        } else {
            drawGrid(currentGrid);
            drawBrushedPoints(currentBrush);
            drawSpecialPoints(critHistory[critHistory.length - 1], 'red', 5);
        }
    }

    function handleZoomEnd(pixelRect) {
        const { left, top, width, height } = pixelRect;
        
        if (width < 5 || height < 5) return;

        viewHistory.push({ 
            xMin: xMinInput.value, 
            xMax: xMaxInput.value, 
            yMin: yMinInput.value, 
            yMax: yMaxInput.value 
        });
        unzoomBtn.disabled = false;

        const cTopLeft = mapPixelToComplex(left, top);
        const cBottomRight = mapPixelToComplex(left + width, top + height);

        let rawXMin = cTopLeft.re;
        let rawXMax = cBottomRight.re;
        let rawYMax = cTopLeft.im;
        let rawYMin = cBottomRight.im;

        const centerX = (rawXMin + rawXMax) / 2;
        const centerY = (rawYMin + rawYMax) / 2;
        
        let newWidth = Math.abs(rawXMax - rawXMin);
        let newHeight = Math.abs(rawYMax - rawYMin);
        
        if (newWidth / newHeight > canvasAspectRatio) {
            newHeight = newWidth / canvasAspectRatio;
        } else {
            newWidth = newHeight * canvasAspectRatio;
        }

        const finalXMin = centerX - newWidth / 2;
        const finalXMax = centerX + newWidth / 2;
        const finalYMin = centerY - newHeight / 2;
        const finalYMax = centerY + newHeight / 2;

        xMinInput.value = finalXMin;
        xMaxInput.value = finalXMax;
        yMinInput.value = finalYMin;
        yMaxInput.value = finalYMax;

        startReset();
    }

    function unzoom() {
        if (viewHistory.length === 0) return;

        const lastView = viewHistory.pop();
        
        xMinInput.value = lastView.xMin;
        xMaxInput.value = lastView.xMax;
        yMinInput.value = lastView.yMin;
        yMaxInput.value = lastView.yMax;
        
        if (viewHistory.length === 0) {
            unzoomBtn.disabled = true;
        }
        
        startReset();
    }

    // Toggle Listeners
    toggleEquiBtn.addEventListener('click', () => {
        showEqui = !showEqui;
        toggleEquiBtn.classList.toggle('active', showEqui);
        requestOverlays();
    });

    toggleRaysBtn.addEventListener('click', () => {
        showRays = !showRays;
        toggleRaysBtn.classList.toggle('active', showRays);
        requestOverlays();
    });

    brushToolBtn.addEventListener('click', () => {
        currentTool = 'brush';
        brushToolBtn.classList.add('active');
        eraserToolBtn.classList.remove('active');
        zoomToolBtn.classList.remove('active'); 
        canvasContainer.classList.add('paint-active');
        canvasContainer.classList.remove('zoom-active'); 
    });

    eraserToolBtn.addEventListener('click', () => {
        currentTool = 'eraser';
        eraserToolBtn.classList.add('active');
        brushToolBtn.classList.remove('active');
        zoomToolBtn.classList.remove('active'); 
        canvasContainer.classList.add('paint-active');
        canvasContainer.classList.remove('zoom-active'); 
    });

    zoomToolBtn.addEventListener('click', () => {
        currentTool = 'zoom';
        zoomToolBtn.classList.add('active');
        brushToolBtn.classList.remove('active');
        eraserToolBtn.classList.remove('active');
        canvasContainer.classList.remove('paint-active');
        canvasContainer.classList.add('zoom-active'); 
    });

    brushSizeSlider.addEventListener('input', (e) => {
        brushSizeLabel.textContent = e.target.value;
    });

    foreCanvas.addEventListener('mousedown', (e) => {
        const rect = foreCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (currentTool === 'brush' || currentTool === 'eraser') {
            isPainting = true;
            paint(mouseX, mouseY);
        } else if (currentTool === 'zoom') {
            isZooming = true;
            zoomStartCoords = { x: mouseX, y: mouseY };
            zoomRect.style.display = 'block';
            zoomRect.style.left = `${mouseX}px`;
            zoomRect.style.top = `${mouseY}px`;
            zoomRect.style.width = '0px';
            zoomRect.style.height = '0px';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPainting && !isZooming) return;

        const rect = foreCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (isPainting) {
            paint(mouseX, mouseY);
        } else if (isZooming) {
            const curX = Math.max(0, Math.min(mouseX, canvasWidth));
            const curY = Math.max(0, Math.min(mouseY, canvasHeight));

            const left = Math.min(curX, zoomStartCoords.x);
            const top = Math.min(curY, zoomStartCoords.y);
            const width = Math.abs(curX - zoomStartCoords.x);
            const height = Math.abs(curY - zoomStartCoords.y);
            
            zoomRect.style.left = `${left}px`;
            zoomRect.style.top = `${top}px`;
            zoomRect.style.width = `${width}px`;
            zoomRect.style.height = `${height}px`;
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (isPainting) {
            isPainting = false;
        } else if (isZooming) {
            isZooming = false;
            zoomRect.style.display = 'none';

            const rect = foreCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const curX = Math.max(0, Math.min(mouseX, canvasWidth));
            const curY = Math.max(0, Math.min(mouseY, canvasHeight));

            const finalRect = {
                left: Math.min(curX, zoomStartCoords.x),
                top: Math.min(curY, zoomStartCoords.y),
                width: Math.abs(curX - zoomStartCoords.x),
                height: Math.abs(curY - zoomStartCoords.y)
            };
            
            handleZoomEnd(finalRect);
        }
    });

    startBtn.addEventListener('click', startReset);
    iterateBtn.addEventListener('click', () => animateStep(false));
    reverseBtn.addEventListener('click', () => animateStep(true));
    unzoomBtn.addEventListener('click', unzoom);

    startReset();
});