// Load math.js library inside the worker
self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.1/math.min.js');

// --- Worker State ---
let P_comp, Q_comp, dP_comp, dQ_comp, ddP_comp, ddQ_comp; 
let h, h_prime;   
let f_prime;      
let g, g_prime;   
let C_crit, dC_crit; 

const NEWTON_ITER = 50;
const POINT_COUNT = 300000; 
const CHUNK_SIZE = 10000; 

// Define global bounds so we find Critical Points even if they are off-screen
const GLOBAL_BOUNDS = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 };

// --- Worker Message Handler ---
self.onmessage = (e) => {
    if (e.data.type === 'calculateOverlays') {
        const { view, canvasWidth, canvasHeight, showEqui, showRays } = e.data;
        
        // Quick check if it's a polynomial by evaluating the denominator at a random point
        const denCheck = Q_comp.evaluate({z: math.complex(Math.random(), Math.random())});
        if (math.abs(math.subtract(denCheck, 1)) > 1e-6) {
            self.postMessage({ type: 'status', payload: 'Overlays only supported for polynomials (Q(z) = 1)' });
            return;
        }

        // Auto-detect the degree 'd' using a large value of z
        const zLarge = math.complex(1000, 0);
        const pLarge = P_comp.evaluate({z: zLarge});
        const degree = Math.round(Math.log(math.abs(pLarge)) / Math.log(1000));

        const overlayData = computeOverlays(view, canvasWidth, canvasHeight, degree, showEqui, showRays);
        self.postMessage({ type: 'overlayData', payload: overlayData });
        return;
    }

    const { numStr, denStr, view, canvasWidth, canvasHeight } = e.data;

    try {
        // --- 1. Compile all functions ---
        self.postMessage({ type: 'status', payload: 'Compiling functions...' });
        
        P_comp = math.parse(numStr).compile();
        Q_comp = math.parse(denStr).compile();
        
        const dP_node = math.derivative(numStr, 'z');
        dP_comp = dP_node.compile();
        
        const dQ_node = math.derivative(denStr, 'z');
        dQ_comp = dQ_node.compile();

        const ddP_node = math.derivative(dP_node, 'z');
        ddP_comp = ddP_node.compile();
        
        const ddQ_node = math.derivative(dQ_node, 'z');
        ddQ_comp = ddQ_node.compile();

        setupHelperFunctions();

        // --- 2. Find Critical Points ---
        self.postMessage({ type: 'status', payload: 'Finding critical points...' });
        
        // Use GLOBAL_BOUNDS to find them even if zoomed in elsewhere
        const criticalPoints = findCriticalPoints(GLOBAL_BOUNDS);
        
        self.postMessage({ type: 'criticalPoints', payload: { points: criticalPoints.map(z => ({ re: z.re, im: z.im })) } });
        
        // --- 3. Find a Repelling Fixed Point ---
        self.postMessage({ type: 'status', payload: 'Finding repelling fixed point...' });
        
        // Use GLOBAL_BOUNDS for the anchor as well
        let z_repel = findRepellingFixedPoint(GLOBAL_BOUNDS);
        
        if (!z_repel) {
            throw new Error('Could not find a repelling fixed point.');
        }
        self.postMessage({ type: 'status', payload: `Found repelling point at ${z_repel.re.toFixed(2)} + ${z_repel.im.toFixed(2)}i` });

        // --- 4. Run Inverse Iteration Method (IIM) ---
        self.postMessage({ type: 'status', payload: 'Running IIM...' });
        const totalPoints = runIIM(z_repel, view, canvasWidth, canvasHeight);
        
        // --- 5. Send final 'complete' message ---
        self.postMessage({ type: 'complete', payload: { totalPoints: totalPoints } });
    } catch (error) {
        self.postMessage({ type: 'result', payload: { error: error.message } });
    }
};

function setupHelperFunctions() {
    // h(z) = P(z) - z*Q(z)
    h = (z) => {
        const scope = { z: z };
        return math.subtract(P_comp.evaluate(scope), math.multiply(z, Q_comp.evaluate(scope)));
    };
    h_prime = (z) => {
        const scope = { z: z };
        return math.subtract(
            dP_comp.evaluate(scope),
            math.add(Q_comp.evaluate(scope), math.multiply(z, dQ_comp.evaluate(scope)))
        );
    };

    // f'(z)
    f_prime = (z) => {
        const scope = { z: z };
        const num = math.subtract(
            math.multiply(dP_comp.evaluate(scope), Q_comp.evaluate(scope)),
            math.multiply(P_comp.evaluate(scope), dQ_comp.evaluate(scope))
        );
        const den = math.pow(Q_comp.evaluate(scope), 2);
        return math.divide(num, den);
    };
    
    // g(z, w) = P(z) - w*Q(z)
    g = (z, w) => {
        const scope = { z: z };
        return math.subtract(P_comp.evaluate(scope), math.multiply(w, Q_comp.evaluate(scope)));
    };
    g_prime = (z, w) => {
        const scope = { z: z };
        return math.subtract(dP_comp.evaluate(scope), math.multiply(w, dQ_comp.evaluate(scope)));
    };

    // C(z) = P'(z)Q(z) - P(z)Q'(z)
    C_crit = (z) => {
        const scope = { z: z };
        return math.subtract(
            math.multiply(dP_comp.evaluate(scope), Q_comp.evaluate(scope)),
            math.multiply(P_comp.evaluate(scope), dQ_comp.evaluate(scope))
        );
    };
    dC_crit = (z) => {
        const scope = { z: z };
        return math.subtract(
            math.multiply(ddP_comp.evaluate(scope), Q_comp.evaluate(scope)),
            math.multiply(P_comp.evaluate(scope), ddQ_comp.evaluate(scope))
        );
    };
}

// --- Algorithms ---

function solveRoots(func, func_prime) {
    const roots = [];
    
    // Deterministic seeds covering the unit circle and origin
    const seeds = [
        math.complex(0, 0),
        math.complex(1, 0), math.complex(-1, 0),
        math.complex(0, 1), math.complex(0, -1),
        math.complex(0.5, 0.5), math.complex(-0.5, -0.5),
        math.complex(0.5, -0.5), math.complex(-0.5, 0.5),
        math.complex(2, 0), math.complex(-2, 0),
        math.complex(0, 2), math.complex(0, -2),
        math.complex(1, 1), math.complex(-1, -1)
    ];

    for (let seed of seeds) {
        let z = newtonStep(seed, func, func_prime);
        
        if (z) {
            // Distance-based deduplication
            let isDuplicate = false;
            for (let existing of roots) {
                const diff = math.abs(math.subtract(z, existing));
                if (diff < 1e-4) {
                    isDuplicate = true;
                    break;
                }
            }
            
            if (!isDuplicate) {
                roots.push(z);
            }
        }
    }
    return roots;
}

function findCriticalPoints(bounds) {
    // We use the deterministic solver to find candidates
    const candidates = solveRoots(C_crit, dC_crit);
    const validRoots = [];
    
    for (const z of candidates) {
        // --- Verify that z is actually a root of C_crit ---
        // We plug z back into C_crit(z) and ensure the result is close to zero.
        try {
            const checkVal = C_crit(z);
            if (math.abs(checkVal) > 1e-6) {
                // Not a valid root 
                continue; 
            }
            validRoots.push(z);
        } catch (err) { continue; }
    }
    
    return validRoots;
}

function findRepellingFixedPoint(bounds) {
    // Solve h(z) = P - zQ = 0
    const fixedPoints = solveRoots(h, h_prime);
        
    if (fixedPoints.length === 0) {
        return null;
    }

    // Pick the most repelling point from the found roots
    let z_repel = null;
    let maxMag = -1;

    for (let z of fixedPoints) {
        try {
            const multiplier = f_prime(z);
            const mag = math.abs(multiplier);
            
            if (mag > 1.0 && mag > maxMag) {
                maxMag = mag;
                z_repel = z;
            }
        } catch(e) {}
    }

    if (!z_repel) z_repel = fixedPoints[0];
    
    return z_repel;
}

function runIIM(startPoint, view, canvasWidth, canvasHeight) {
    let current_z = startPoint;
    let pointChunk = [];
    let totalPoints = 0;
    
    for (let i = 0; i < POINT_COUNT; i++) {
        const w = current_z; 
        
        // Mixed guessing: 30% Global, 70% View (bias for detail on screen)
        const searchBounds = (Math.random() > 0.7) ? GLOBAL_BOUNDS : view;
        const z_guess = randomComplex(searchBounds);
        
        const preimage_z = newtonStep(z_guess, (z) => g(z, w), (z) => g_prime(z, w));
        
        if (!preimage_z) {
            current_z = startPoint;
            continue;
        }

        current_z = preimage_z;
        
        const [px, py] = mapComplexToPixel(current_z, view, canvasWidth, canvasHeight);
        if (px >= 0 && px < canvasWidth && py >= 0 && py < canvasHeight) {
            pointChunk.push([px, py]);
            totalPoints++;
        }

        if (pointChunk.length >= CHUNK_SIZE) {
            self.postMessage({ type: 'chunk', payload: { points: pointChunk } });
            pointChunk = []; 
        }
    }

    if (pointChunk.length > 0) {
        self.postMessage({ type: 'chunk', payload: { points: pointChunk } });
    }

    return totalPoints;
}

// --- Utility Functions ---

function newtonStep(z_guess, func, func_prime) {
    let z = z_guess;
    for (let j = 0; j < NEWTON_ITER; j++) {
        try {
            const gz = func(z);
            const g_prime_z = func_prime(z);

            if (math.abs(g_prime_z) < 1e-12) {
                return null; 
            }
            
            const step = math.divide(gz, g_prime_z);
            if (math.abs(step) < 1e-12) {
                return z; 
            }
            z = math.subtract(z, step);
            
            if (!isFinite(z.re) || !isFinite(z.im)) {
                return null;
            }
        } catch (e) {
            return null; 
        }
    }
    return z; 
}

function randomComplex(bounds) {
    const re = bounds.xMin + Math.random() * (bounds.xMax - bounds.xMin);
    const im = bounds.yMin + Math.random() * (bounds.yMax - bounds.yMin);
    return math.complex(re, im);
}

function mapComplexToPixel(z, view, canvasWidth, canvasHeight) {
    const x = ((z.re - view.xMin) / (view.xMax - view.xMin)) * canvasWidth;
    const y = ((view.yMax - z.im) / (view.yMax - view.yMin)) * canvasHeight; 
    return [Math.floor(x), Math.floor(y)];
}

function computeOverlays(view, width, height, degree, showEqui, showRays) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const maxIter = 50; 
    const escapeRadiusSq = 10000; // R = 100
    
    // We want 12 equally spaced external rays
    const rayAngles = Array.from({length: 12}, (_, i) => (i * 2 * Math.PI) / 12);

    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const re = view.xMin + (px / width) * (view.xMax - view.xMin);
            const im = view.yMax - (py / height) * (view.yMax - view.yMin);
            let z = math.complex(re, im);
            
            let iter = 0;
            let escaped = false;

            while (iter < maxIter) {
                if (z.re * z.re + z.im * z.im > escapeRadiusSq) {
                    escaped = true;
                    break;
                }
                try {
                    z = P_comp.evaluate({z: z});
                } catch(e) { break; }
                iter++;
            }

            const index = (py * width + px) * 4;

            if (escaped) {
                let isEqui = false;
                let isRay = false;

                if (showEqui) {
                    const modZ = math.abs(z);
                    const G = Math.log(modZ) / Math.pow(degree, iter);
                    const band = (G % 0.2) / 0.2;
                    if (band < 0.05 || band > 0.95) isEqui = true;
                }

                if (showRays) {
                    const argZn = math.arg(z); 
                    const d_n = Math.pow(degree, iter);
                    
                    for (let targetTheta of rayAngles) {
                        const expectedArg = (d_n * targetTheta) % (2 * Math.PI);
                        let diff = Math.abs(argZn - (expectedArg > Math.PI ? expectedArg - 2 * Math.PI : expectedArg));
                        
                        if (diff > Math.PI) diff = 2 * Math.PI - diff;
                        
                        if (diff < 0.15) {
                            isRay = true;
                            break;
                        }
                    }
                }

                pixels[index] = isEqui ? 255 : (isRay ? 0 : 0);
                pixels[index + 1] = isEqui ? 255 : (isRay ? 255 : 0);
                pixels[index + 2] = isEqui ? 255 : (isRay ? 255 : 0);
                pixels[index + 3] = (isEqui || isRay) ? 200 : 0; 
            } else {
                pixels[index + 3] = 0; 
            }
        }
    }
    return pixels;
}