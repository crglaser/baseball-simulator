import { teamData } from "./team_data.js";

// State
let lineup = [];
let isSimulating = false;
let simulationSpeed = 500;
let simulationInterval = null;
let gameResults = []; 

// Player-specific cumulative stats
// Initialize with all possible players from teamData to ensure all keys exist
const playerStats = {}; 
Object.values(teamData).flat().forEach(p => {
    if (p.id) {
        playerStats[p.id] = { PA: 0, 1B: 0, 2B: 0, 3B: 0, HR: 0, BB: 0, Outs: 0, gamesPlayed: 0 };
    }
});

// Game Stats
let currentGame = {
    inning: 1,
    outs: 0,
    runs: 0,
    bases: [null, null, null], 
    batterIndex: 0,
    playerGameStats: {} // For current game only, reset each game
};

// Cumulative Stats (Overall)
let totalGames = 0;
let totalRuns = 0;

// Drag and Drop State
let draggedItemIndex = null;

// DOM Elements Container
let elements = {};

// Initialization
function init() {
    console.log("Simulator Initializing...");
    
    // Bind Elements
    elements = {
        lineupTableBody: document.querySelector("#lineupTable tbody"),
        inningDisplay: document.getElementById("inningDisplay"),
        outsDisplay: document.getElementById("outsDisplay"),
        runsDisplay: document.getElementById("runsDisplay"),
        currentBatterDisplay: document.getElementById("currentBatterDisplay"),
        bases: [
            document.getElementById("base1"),
            document.getElementById("base2"),
            document.getElementById("base3")
        ],
        gamesSimulated: document.getElementById("gamesSimulated"),
        totalRuns: document.getElementById("totalRuns"),
        avgRuns: document.getElementById("avgRuns"),
        startBtn: document.getElementById("startBtn"),
        stopBtn: document.getElementById("stopBtn"),
        resetBtn: document.getElementById("updateLineupBtn"),
        speedControl: document.getElementById("speedControl"),
        speedVal: document.getElementById("speedVal"),
        gameLog: document.getElementById("gameLog"),
        batchSimInput: document.getElementById("batchSimInput"),
        batchSimBtn: document.getElementById("batchSimBtn"),
        histogramContainer: document.getElementById("histogramContainer"),
        teamSelect: document.getElementById("teamSelect")
    };

    if (!elements.lineupTableBody) {
        console.error("Critical Error: DOM elements not found.");
        return;
    }

    // Populate Team Selector
    elements.teamSelect.innerHTML = "";
    Object.keys(teamData).forEach(key => {
        const option = document.createElement("option");
        option.value = key;
        // A more robust way to get a display name, assuming keys are like "mets", "yankees" etc.
        // Could be improved with a manual lookup map if very specific display names are needed.
        let teamDisplayName = key.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

        // Special cases for team names
        const teamNameMap = {
            "angels": "Los Angeles Angels",
            "orioles": "Baltimore Orioles",
            "redsox": "Boston Red Sox",
            "whitesox": "Chicago White Sox",
            "guardians": "Cleveland Guardians",
            "tigers": "Detroit Tigers",
            "royals": "Kansas City Royals",
            "twins": "Minnesota Twins",
            "yankees": "New York Yankees",
            "athletics": "Oakland Athletics",
            "mariners": "Seattle Mariners",
            "rays": "Tampa Bay Rays",
            "rangers": "Texas Rangers",
            "bluejays": "Toronto Blue Jays",
            "diamondbacks": "Arizona Diamondbacks",
            "braves": "Atlanta Braves",
            "cubs": "Chicago Cubs",
            "reds": "Cincinnati Reds",
            "rockies": "Colorado Rockies",
            "marlins": "Miami Marlins",
            "astros": "Houston Astros",
            "dodgers": "Los Angeles Dodgers",
            "brewers": "Milwaukee Brewers",
            "nationals": "Washington Nationals",
            "mets": "New York Mets",
            "phillies": "Philadelphia Phillies",
            "pirates": "Pittsburgh Pirates",
            "cardinals": "St. Louis Cardinals",
            "padres": "San Diego Padres",
            "giants": "San Francisco Giants"
        };
        option.textContent = teamNameMap[key] || teamDisplayName; // Use map if available, else default
        if (key === "mets") option.selected = true;
        elements.teamSelect.appendChild(option);
    });

    loadLineup(teamData["mets"]); // Default to Mets
    setupEventListeners();
    resetGame();
    log("Ready to play ball!");
    setupResizer();
}

function setupResizer() {
    const resizer = document.getElementById("panelResizer");
    const lineupPanel = document.getElementById("lineupPanel");
    const simulationPanel = document.getElementById("simulationPanel");
    let isResizing = false;

    resizer.addEventListener("mousedown", (e) => {
        isResizing = true;
        document.body.style.cursor = "ew-resize";
    });

    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;

        const container = lineupPanel.parentElement;
        const totalWidth = container.offsetWidth;
        const mouseX = e.clientX;
        
        // Calculate percentage for lineupPanel
        const lineupWidth = mouseX - container.offsetLeft; // Adjust for container's position
        let newFlexBasis = (lineupWidth / totalWidth) * 100;

        // Clamp values to prevent panels from disappearing
        newFlexBasis = Math.max(30, Math.min(70, newFlexBasis)); 

        lineupPanel.style.flexBasis = `${newFlexBasis}%`;
        simulationPanel.style.flexBasis = `${100 - newFlexBasis}%`;
    });

    document.addEventListener("mouseup", () => {
        isResizing = false;
        document.body.style.cursor = "default";
    });
}

function optimizeLineup() {
    const statusEl = document.getElementById("optimizationStatus");
    const optimizeBtn = document.getElementById("optimizeBtn");
    
    // UI Loading State
    statusEl.textContent = "Initializing Optimization...";
    optimizeBtn.disabled = true;
    document.body.style.cursor = "wait";

    // Ensure we have current data
    updateLineupFromDOM();
    
    // Preservation
    const originalLineupHead = lineup.slice(0, 9);
    const bench = lineup.slice(9);
    
    // Optimization State
    let bestLineup = [...originalLineupHead];
    let bestAvg = -1; // Will be set on first run
    
    // Config
    const ITERATIONS = 10000; // Requested scale
    const GAMES_PER_EVAL = 50; // Reduced for speed during search (screening)
    const VERIFICATION_GAMES = 10000; // High confidence final check
    
    let i = 0;

    // Baseline calculation
    statusEl.textContent = `Establishing Baseline...`;
    
    setTimeout(() => {
        bestAvg = evaluateLineup(bestLineup, GAMES_PER_EVAL);
        
        // 1. Inject Smart Candidates (Heuristics)
        const candidates = [];
        
        // Heuristic 1: Sort by OBP (Lowest Out%)
        const lineupOBP = [...bestLineup].sort((a, b) => a.out - b.out);
        candidates.push({ name: "OBP Sort", lineup: lineupOBP });
        
        // Heuristic 2: Sort by SLG (Approximate Power)
        const calcSLG = (p) => p.single + (2 * p.double) + (3 * p.triple) + (4 * p.hr);
        const lineupSLG = [...bestLineup].sort((a, b) => calcSLG(b) - calcSLG(a));
        candidates.push({ name: "SLG Sort", lineup: lineupSLG });
        
        // Evaluate Heuristics
        candidates.forEach(cand => {
            const avg = evaluateLineup(cand.lineup, 500); // Give heuristics a fair shake with more games
            if (avg > bestAvg) {
                bestLineup = cand.lineup;
                bestAvg = avg;
                console.log(`Heuristic ${cand.name} took lead: ${avg}`);
            }
        });

        // Async Loop for UI responsiveness
        function step() {
            if (i >= ITERATIONS) {
                finalize();
                return;
            }
            
            // Batch iterations to speed up total time while keeping UI responsive
            // 10,000 iterations needs larger batch size to finish in seconds
            const batchSize = 200; 
            for (let b = 0; b < batchSize; b++) {
                if (i >= ITERATIONS) break;
                
                // Mutate
                const candidate = [...bestLineup];
                const idx1 = Math.floor(Math.random() * 9);
                const idx2 = Math.floor(Math.random() * 9);
                if (idx1 === idx2) continue;
                
                [candidate[idx1], candidate[idx2]] = [candidate[idx2], candidate[idx1]];
                
                // Evaluate
                const currentAvg = evaluateLineup(candidate, GAMES_PER_EVAL);
                
                // We accept if better. 
                // Note: With 50 games, noise is high. We might accept a "lucky" bad lineup.
                // But over 10,000 iterations, we hope to find a "lucky" GOOD lineup and stick to it.
                // To prevent drifting into mediocrity, maybe we only swap if SIGNIFICANTLY better?
                // Or keep track of "All Time Best" separately from "Current Walker"?
                // Let`s simple Hill Climb: if better, take it.
                if (currentAvg > bestAvg) {
                    bestLineup = candidate;
                    bestAvg = currentAvg;
                }
                i++;
            }
            
            statusEl.textContent = `Optimizing... ${Math.round((i / ITERATIONS) * 100)}%`;
            setTimeout(step, 0);
        }

        function finalize() {
            statusEl.textContent = "Verifying Results...";
            
            setTimeout(() => {
                // Final Verification: Run HUGE sample on Original vs New Best
                const finalOriginalAvg = evaluateLineup(originalLineupHead, VERIFICATION_GAMES);
                const finalBestAvg = evaluateLineup(bestLineup, VERIFICATION_GAMES);
                
                const diff = finalBestAvg - finalOriginalAvg;
                
                // Apply changes
                // Note: Even if diff is small/negative due to noise, if the heuristic found it, it`s likely better or equal. 
                // But let`s be safe: if it`s explicitly worse in the large sample, revert.
                
                if (diff < -0.01) {
                    // Revert if significantly worse (noise buffer)
                    log(`Optimization reverted: Found lineup was worse in validation (${diff.toFixed(3)}).`);
                    statusEl.textContent = "Optimization: No significant improvement found.";
                } else {
                    // Apply
                    lineup = [...bestLineup, ...bench];
                    loadLineup(lineup);
                    
                    const diffStr = diff >= 0 ? `+${diff.toFixed(3)}` : diff.toFixed(3);
                    statusEl.textContent = `Optimization Complete! Verified Improvement: ${diffStr} Runs/Game`;
                    log(`Optimization applied. Baseline: ${finalOriginalAvg.toFixed(3)} -> New: ${finalBestAvg.toFixed(3)}`);
                }
                
                optimizeBtn.disabled = false;
                document.body.style.cursor = "default";
            }, 50);
        }
        
        step();
    }, 50);
}

function evaluateLineup(testLineup, numGames) {
    let total = 0;
    for (let i = 0; i < numGames; i++) {
        total += simulateQuickGame(testLineup);
    }
    return total / numGames;
}

function getHeadshotUrl(id) {
    if (!id) return "https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/generic/headshot/67/current";
    return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${id}/headshot/67/current`;
}

function loadLineup(data) {
    elements.lineupTableBody.innerHTML = "";
    lineup = []; 
    
    data.forEach((player, index) => {
        // Visual Divider for Bench
        if (index === 9) {
            const separator = document.createElement("tr");
            separator.className = "bench-divider";
            separator.innerHTML = "<td colspan=\"8\">Bench / Reserves (Drag to swap)</td>";
            elements.lineupTableBody.appendChild(separator);
        }

        const row = document.createElement("tr");
        row.draggable = true;
        row.dataset.index = index;
        row.classList.add("lineup-row");
        if (index >= 9) row.classList.add("bench-row");
        
        const totalProb = player.single + player.double + player.triple + player.hr + player.bb;
        const outProb = Math.max(0, 100 - totalProb).toFixed(1);
        
        // Calculate estimated wOBA (using 2024 constants approx)
        // wOBA = (0.69×uBB + 0.72×HBP + 0.89×1B + 1.27×2B + 1.62×3B + 2.10×HR) / (AB + BB – IBB + SF + HBP)
        // Since inputs are % of PA, we can just sum weighted percentages / 100
        const wobaVal = (
            (0.69 * player.bb) + 
            (0.89 * player.single) + 
            (1.27 * player.double) + 
            (1.62 * player.triple) + 
            (2.10 * player.hr)
        ) / 100;
        const wobaStr = wobaVal.toFixed(3).replace(/^0+/, ""); // Remove leading zero like baseball stats

        const imgUrl = getHeadshotUrl(player.id);
        const orderNum = index < 9 ? index + 1 : "B";
        
        row.innerHTML = `
            <td class="drag-handle" style="cursor: move;">☰ ${orderNum}</td>
            <td style="display: flex; align-items: center; gap: 10px;">
                <img src="${imgUrl}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                <input type="text" value="${player.name}" style="width: 140px" data-field="name">
                <input type="hidden" value="${player.id || ""}" data-field="id">
            </td>
            <td><input type="number" value="${player.single}" min="0" max="100" step="0.1" data-field="single"></td>
            <td><input type="number" value="${player.double}" min="0" max="100" step="0.1" data-field="double"></td>
            <td><input type="number" value="${player.triple}" min="0" max="100" step="0.1" data-field="triple"></td>
            <td><input type="number" value="${player.hr}" min="0" max="100" step="0.1" data-field="hr"></td>
            <td><input type="number" value="${player.bb}" min="0" max="100" step="0.1" data-field="bb"></td>
            <td class="out-prob">${outProb}%</td>
            <td style="font-weight: bold; color: #555;">${wobaStr}</td>
        `;
        
        elements.lineupTableBody.appendChild(row);
        lineup.push({ ...player, out: parseFloat(outProb) });

        const inputs = row.querySelectorAll("input");
        inputs.forEach(input => {
            input.addEventListener("change", () => updateLineupFromDOM());
        });

        row.addEventListener("dragstart", handleDragStart);
        row.addEventListener("dragover", handleDragOver);
        row.addEventListener("drop", handleDrop);
        row.addEventListener("dragenter", handleDragEnter);
        row.addEventListener("dragleave", handleDragLeave);
    });
}

function handleDragStart(e) {
    draggedItemIndex = parseInt(this.dataset.index);
    e.dataTransfer.effectAllowed = "move";
    this.style.opacity = "0.4";
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    return false;
}

function handleDragEnter(e) { this.classList.add("over"); }
function handleDragLeave(e) { this.classList.remove("over"); }

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    this.classList.remove("over");
    
    const targetIndex = parseInt(this.dataset.index);
    if (draggedItemIndex !== targetIndex) {
        updateLineupFromDOM(); 
        const item = lineup.splice(draggedItemIndex, 1)[0];
        lineup.splice(targetIndex, 0, item);
        loadLineup(lineup);
    }
    document.querySelectorAll(".lineup-row").forEach(row => row.style.opacity = "1");
    return false;
}

function updateLineupFromDOM() {
    const rows = elements.lineupTableBody.querySelectorAll(".lineup-row");
    lineup = [];
    
    rows.forEach((row, index) => {
        const name = row.querySelector("[data-field=\"name\"]").value;
        const idStr = row.querySelector("[data-field=\"id\"]").value;
        const id = idStr ? parseInt(idStr) : null;
        
        const single = parseFloat(row.querySelector("[data-field=\"single\"]").value) || 0;
        const double = parseFloat(row.querySelector("[data-field=\"double\"]").value) || 0;
        const triple = parseFloat(row.querySelector("[data-field=\"triple\"]").value) || 0;
        const hr = parseFloat(row.querySelector("[data-field=\"hr\"]").value) || 0;
        const bb = parseFloat(row.querySelector("[data-field=\"bb\"]").value) || 0;
        
        let total = single + double + triple + hr + bb;
        const out = Math.max(0, 100 - total);
        row.querySelector(".out-prob").textContent = `${out.toFixed(1)}%`;

        // Update wOBA display on change
        const wobaVal = ((0.69 * bb) + (0.89 * single) + (1.27 * double) + (1.62 * triple) + (2.10 * hr)) / 100;
        const wobaCell = row.lastElementChild; // Assuming wOBA is last
        if (wobaCell) wobaCell.textContent = wobaVal.toFixed(3).replace(/^0+/, "");
        
        lineup.push({ id, name, single, double, triple, hr, bb, out });
    });
}

function sortByWOBA() {
    // Ensure we have current data
    updateLineupFromDOM();
    
    const calcWOBA = (p) => ((0.69 * p.bb) + (0.89 * p.single) + (1.27 * p.double) + (1.62 * p.triple) + (2.10 * p.hr));
    
    // Sort descending by wOBA
    lineup.sort((a, b) => calcWOBA(b) - calcWOBA(a));
    
    loadLineup(lineup);
    log("Lineup sorted by projected wOBA.");
}

function setupEventListeners() {
    elements.startBtn.addEventListener("click", startSimulation);
    elements.stopBtn.addEventListener("click", stopSimulation);
    elements.resetBtn.addEventListener("click", () => {
        stopSimulation();
        updateLineupFromDOM(); 
        resetStats();
        resetGame();
        log("Lineup updated and stats reset.");
    });
    elements.speedControl.addEventListener("input", (e) => {
        simulationSpeed = parseInt(e.target.value);
        elements.speedVal.textContent = `${simulationSpeed}ms`;
    });
    elements.batchSimBtn.addEventListener("click", runBatchSimulation);
    
    const optimizeBtn = document.getElementById("optimizeBtn");
    if (optimizeBtn) optimizeBtn.addEventListener("click", optimizeLineup);

    const sortWobaBtn = document.getElementById("sortWobaBtn");
    if (sortWobaBtn) sortWobaBtn.addEventListener("click", sortByWOBA);

    elements.teamSelect.addEventListener("change", (e) => {
        stopSimulation();
        const teamKey = e.target.value;
        // Find the full display name from the map
        const teamDisplayName = elements.teamSelect.options[elements.teamSelect.selectedIndex].textContent;
        loadLineup(teamData[teamKey]);
        resetStats();
        resetGame();
        log(`Switched to ${teamDisplayName}.`);
    });

    const runLeagueBtn = document.getElementById("runLeagueBtn");
    if (runLeagueBtn) {
        runLeagueBtn.addEventListener("click", runLeagueSimulation);
    }
}

function runBatchSimulation() {
    const numGames = parseInt(elements.batchSimInput.value) || 10;
    if (numGames <= 0) return;

    stopSimulation();
    updateLineupFromDOM();
    
    log(`Running batch simulation of ${numGames} games...`);
    elements.batchSimBtn.disabled = true;
    document.body.style.cursor = "wait";

    setTimeout(() => {
        try {
            const startTime = performance.now();
            for (let i = 0; i < numGames; i++) {
                simulateQuickGame();
            }
            const endTime = performance.now();
            log(`Batch complete in ${(endTime - startTime).toFixed(0)}ms.`);
            
            elements.gamesSimulated.textContent = totalGames;
            elements.totalRuns.textContent = totalRuns;
            elements.avgRuns.textContent = (totalRuns / totalGames).toFixed(2);
            updateHistogram();
        } catch (e) {
            log(`Error in batch sim: ${e.message}`);
            console.error(e);
        } finally {
            elements.batchSimBtn.disabled = false;
            document.body.style.cursor = "default";
            resetGame();
        }
    }, 50);
}

// League Simulation Logic
function runLeagueSimulation() {
    const numGames = parseInt(document.getElementById("leagueSimCount").value) || 162;
    const btn = document.getElementById("runLeagueBtn");
    const tableBody = document.querySelector("#leagueTable tbody");
    const resultsArea = document.getElementById("leagueResultsArea");

    btn.disabled = true;
    btn.textContent = "Simulating...";
    document.body.style.cursor = "wait";

    setTimeout(() => {
        const leagueResults = [];

        Object.keys(teamData).forEach(teamKey => {
            // Prepare lineup for this team (calculate Out%)
            const rawRoster = teamData[teamKey];
            const simLineup = rawRoster.slice(0, 9).map(p => {
                const total = p.single + p.double + p.triple + p.hr + p.bb;
                return { ...p, out: Math.max(0, 100 - total) }; // No rounding needed for logic
            });

            // Run Sim
            const teamRuns = [];
            for (let i = 0; i < numGames; i++) {
                teamRuns.push(simulateQuickGame(simLineup));
            }

            // Stats
            const total = teamRuns.reduce((a, b) => a + b, 0);
            const avg = total / numGames;
            const max = Math.max(...teamRuns);
            const shutouts = teamRuns.filter(r => r === 0).length;

            leagueResults.push({
                team: teamKey,
                teamName: teamKey.charAt(0).toUpperCase() + teamKey.slice(1),
                avg: avg,
                max: max,
                shutouts: shutouts,
                runs: teamRuns // Store full distribution for detail view
            });
        });

        // Sort by Avg Descending
        leagueResults.sort((a, b) => b.avg - a.avg);

        // Render
        tableBody.innerHTML = "";
        leagueResults.forEach((res, index) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${index + 1}</td>
                <td class="team-link" onclick="showTeamDetail(\"${res.team}\")">${res.teamName}</td>
                <td>${res.avg.toFixed(2)}</td>
                <td>${res.max}</td>
                <td>${res.shutouts}</td>
            `;
            // Store data on row for easy access if needed, but onclick handler handles it
            row.onclick = () => showTeamDetail(res); 
            tableBody.appendChild(row);
        });

        resultsArea.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Run League Sim";
        document.body.style.cursor = "default";
    }, 100);
}

// Global scope for onclick access (simpler for this context)
window.showTeamDetail = function(teamDataObj) {
    if (typeof teamDataObj === "string") return; // Handled by row onclick passing object
    
    const overlay = document.getElementById("detailOverlay");
    const nameEl = document.getElementById("detailTeamName");
    const statsEl = document.getElementById("detailStats");
    const histEl = document.getElementById("detailHistogram");
    
    nameEl.textContent = teamDataObj.teamName;
    
    // Histogram for specific team
    renderDetailHistogram(teamDataObj.runs, histEl);
    
    overlay.classList.add("open");
};

function renderDetailHistogram(runsData, container) {
    const counts = {};
    let maxRun = 0;
    runsData.forEach(r => {
        counts[r] = (counts[r] || 0) + 1;
        if (r > maxRun) maxRun = r;
    });
    
    let html = "";
    const maxFreq = Math.max(...Object.values(counts));
    
    html += "<div class=\"histogram-bars\">";
    for (let r = 0; r <= Math.max(12, maxRun); r++) {
        const count = counts[r] || 0;
        const heightPct = maxFreq > 0 ? (count / maxFreq) * 100 : 0;
        const barColor = count > 0 ? "#e74c3c" : "#f5f5f5"; // Different color for distinction
        html += `<div class="hist-bar-group" title="${count} games"><div class="hist-bar" style="height: ${heightPct}%; background-color: ${barColor};"></div><div class="hist-label">${r}</div></div>`;
    }
    html += "</div>";
    container.innerHTML = html;
}

function simulateQuickGame(targetLineup) {
    // If targetLineup provided, use it. Otherwise use global 'lineup'.
    const useLineup = targetLineup || lineup;

    let gameInning = 1;
    let gameOuts = 0;
    let gameRuns = 0;
    let gameBases = [null, null, null];
    let batterIdx = 0;

    // Initialize player game stats for this simulation
    const currentPlayerGameStats = {};
    useLineup.forEach(p => {
        if (p.id) currentPlayerGameStats[p.id] = { PA: 0, 1B: 0, 2B: 0, 3B: 0, HR: 0, BB: 0, Outs: 0 };
    });

    
    while (gameInning <= 9) {
        const batter = useLineup[batterIdx];

        // Track PA
        if (batter.id) currentPlayerGameStats[batter.id].PA++;

        const roll = Math.random() * 100;
        let accumulated = 0;
        let result = "Out";
        
        if (roll < (accumulated += batter.bb)) {
            result = "BB";
            if (batter.id) currentPlayerGameStats[batter.id].BB++;
        } else if (roll < (accumulated += batter.single)) {
            result = "1B";
            if (batter.id) currentPlayerGameStats[batter.id]["1B"]++;
        } else if (roll < (accumulated += batter.double)) {
            result = "2B";
            if (batter.id) currentPlayerGameStats[batter.id]["2B"]++;
        } else if (roll < (accumulated += batter.triple)) {
            result = "3B";
            if (batter.id) currentPlayerGameStats[batter.id]["3B"]++;
        } else if (roll < (accumulated += batter.hr)) {
            result = "HR";
            if (batter.id) currentPlayerGameStats[batter.id].HR++;
        } else {
            // It is an Out
            if (batter.id) currentPlayerGameStats[batter.id].Outs++;
        }

        
        if (result === "Out") {
            gameOuts++;
            if (gameOuts >= 3) {
                gameOuts = 0;
                gameBases = [null, null, null];
                gameInning++;
            }
        } else {
            let runs = 0;
            let newBases = [...gameBases];
            
            if (result === "BB") {
                if (newBases[0] === null) newBases[0] = batter.id;
                else if (newBases[1] === null) { newBases[1] = newBases[0]; newBases[0] = batter.id; }
                else if (newBases[2] === null) { newBases[2] = newBases[1]; newBases[1] = newBases[0]; newBases[0] = batter.id; }
                else { runs++; newBases[2] = newBases[1]; newBases[1] = newBases[0]; newBases[0] = batter.id; }
            } else if (result === "1B") {
                if (newBases[2]) { runs++; newBases[2] = null; }
                if (newBases[1]) {
                    if (Math.random() < 0.60) { runs++; newBases[1] = null; }
                    else { newBases[2] = newBases[1]; newBases[1] = null; }
                }
                if (newBases[0]) {
                    if (newBases[2] === null && Math.random() < 0.10) { newBases[2] = newBases[0]; newBases[0] = null; }
                    else { newBases[1] = newBases[0]; newBases[0] = null; }
                }
                newBases[0] = batter.id;
            } else if (result === "2B") {
                if (newBases[2]) { runs++; newBases[2] = null; }
                if (newBases[1]) { runs++; newBases[1] = null; }
                if (newBases[0]) {
                    if (Math.random() < 0.45) { runs++; newBases[0] = null; }
                    else { newBases[2] = newBases[0]; newBases[0] = null; }
                }
                newBases[1] = batter.id;
            } else if (result === "3B") {
                if (newBases[2]) runs++; if (newBases[1]) runs++; if (newBases[0]) runs++;
                newBases = [null, null, batter.id];
            } else if (result === "HR") {
                if (newBases[2]) runs++; if (newBases[1]) runs++; if (newBases[0]) runs++;
                runs++;
                newBases = [null, null, null];
            }
            
            gameBases = newBases;
            gameRuns += runs;
        }
        // Only use top 9 batters
        batterIdx = (batterIdx + 1) % 9;
    }
    
    // Only update global stats if we are running the main simulation (not a league batch sim)
    if (!targetLineup) {
        totalGames++;
        totalRuns += gameRuns;
        gameResults.push(gameRuns);

        lineup.forEach(p => {
            if (p.id && currentGame.playerGameStats[p.id]) {
                playerStats[p.id].PA += currentGame.playerGameStats[p.id].PA;
                playerStats[p.id]["1B"] += currentGame.playerGameStats[p.id]["1B"];
                playerStats[p.id]["2B"] += currentGame.playerGameStats[p.id]["2B"];
                playerStats[p.id]["3B"] += currentGame.playerGameStats[p.id]["3B"];
                playerStats[p.id].HR += currentGame.playerGameStats[p.id].HR;
                playerStats[p.id].BB += currentGame.playerGameStats[p.id].BB;
                playerStats[p.id].Outs += currentGame.playerGameStats[p.id].Outs;
                // Only increment gamesPlayed once per game for players who actually had a PA
                if (currentGame.playerGameStats[p.id].PA > 0) {
                    playerStats[p.id].gamesPlayed++;
                }
            }
        });

        updatePlayerStatsUI(); // New function to update individual player stats display
    }
    
    return gameRuns;
}

function updatePlayerStatsUI() {
    // This will iterate through the displayed lineup and update their stats rows
    const rows = elements.lineupTableBody.querySelectorAll(".lineup-row");
    rows.forEach(row => {
        const playerId = parseInt(row.querySelector("[data-field=\"id\"]").value);
        if (playerId && playerStats[playerId]) {
            const stats = playerStats[playerId];
            const games = stats.gamesPlayed;

            let statsHtml = 
                `<tr class="player-sim-stats">
                    <td></td> <!-- For order num -->
                    <td colspan="8" style="font-size: 0.75em; color: #666;">
                        PA: ${stats.PA} | 1B: ${stats["1B"]} | 2B: ${stats["2B"]} | 3B: ${stats["3B"]} | HR: ${stats.HR} | BB: ${stats.BB} | Outs: ${stats.Outs}
                        <br>
                        Avg/Game: ${games > 0 ? (stats.PA / games).toFixed(1) : 0} PA, 
                                  ${games > 0 ? (stats["1B"] / games).toFixed(1) : 0} 1B, 
                                  ${games > 0 ? (stats["2B"] / games).toFixed(1) : 0} 2B, 
                                  ${games > 0 ? (stats["3B"] / games).toFixed(1) : 0} 3B, 
                                  ${games > 0 ? (stats.HR / games).toFixed(1) : 0} HR, 
                                  ${games > 0 ? (stats.BB / games).toFixed(1) : 0} BB
                        <br>
                        162 Games: ${games > 0 ? ((stats.PA / games) * 162).toFixed(0) : 0} PA, 
                                   ${games > 0 ? ((stats.HR / games) * 162).toFixed(0) : 0} HR, 
                                   ${games > 0 ? ((stats.BB / games) * 162).toFixed(0) : 0} BB
                    </td>
                </tr>`;
            
            // Find existing stats row or create new
            let existingStatsRow = row.nextElementSibling;
            if (existingStatsRow && existingStatsRow.classList.contains("player-sim-stats")) {
                existingStatsRow.innerHTML = statsHtml;
            } else {
                const newRow = document.createElement("tr");
                newRow.className = "player-sim-stats";
                newRow.innerHTML = statsHtml;
                row.parentNode.insertBefore(newRow, existingStatsRow);
            }
        }
    });
}


function updateHistogram() {
    if (gameResults.length === 0) return;
    const counts = {};
    let maxRun = 0;
    gameResults.forEach(r => {
        counts[r] = (counts[r] || 0) + 1;
        if (r > maxRun) maxRun = r;
    });
    
    let html = "";
    const maxFreq = Math.max(...Object.values(counts));
    const sorted = [...gameResults].sort((a,b) => a-b);
    const median = sorted[Math.floor(sorted.length/2)];
    const avg = (totalRuns / totalGames).toFixed(2);
    
    html += `<div style="margin-bottom: 10px; font-weight: bold; color: #2c3e50;">Median: ${median} | Mean: ${avg} | Max: ${maxRun}</div>`;
    html += "<div class=\"histogram-bars\">";
    for (let r = 0; r <= Math.max(15, maxRun); r++) {
        const count = counts[r] || 0;
        const heightPct = maxFreq > 0 ? (count / maxFreq) * 100 : 0;
        const barColor = count > 0 ? "#3498db" : "#ecf0f1"; // Different color for distinction
        html += `<div class="hist-bar-group" title="${count} games"><div class="hist-bar" style="height: ${heightPct}%; background-color: ${barColor};"></div><div class="hist-label">${r}</div></div>`;
    }
    html += "</div>";
    elements.histogramContainer.innerHTML = html;
}

function startSimulation() {
    if (isSimulating) return;
    isSimulating = true;
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.resetBtn.disabled = true;
    elements.batchSimBtn.disabled = true;
    log("Visual Simulation started.");
    if (currentGame.inning > 9) resetGame();
    runGameLoop();
}

function stopSimulation() {
    isSimulating = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    elements.resetBtn.disabled = false;
    elements.batchSimBtn.disabled = false;
    log("Simulation paused.");
}

function resetGame() {
    currentGame = { inning: 1, outs: 0, runs: 0, bases: [null, null, null], batterIndex: 0 };
    // Reset current game player stats too
    currentGame.playerGameStats = {};
    updateUI();
}

function resetStats() {
    totalGames = 0; totalRuns = 0; gameResults = [];
    // Reset individual player stats too
    Object.values(playerStats).forEach(stats => {
        stats.PA = 0; stats["1B"] = 0; stats["2B"] = 0; stats["3B"] = 0; stats.HR = 0; stats.BB = 0; stats.Outs = 0; stats.gamesPlayed = 0;
    });
    document.getElementById("gamesSimulated").textContent = "0";
    document.getElementById("totalRuns").textContent = "0";
    document.getElementById("avgRuns").textContent = "0.00";
    elements.gameLog.innerHTML = "";
    elements.histogramContainer.innerHTML = "";
    updatePlayerStatsUI(); // Clear displayed stats
}

function runGameLoop() {
    if (!isSimulating) return;
    try {
        playAtBat();
        updateUI();
        if (currentGame.inning > 9) {
            finishGame();
            setTimeout(() => { if (isSimulating) { resetGame(); runGameLoop(); } }, simulationSpeed);
        } else {
            setTimeout(runGameLoop, simulationSpeed);
        }
    } catch (e) {
        log("Error in visual sim: " + e.message);
        stopSimulation();
    }
}

function finishGame() {
    totalGames++; totalRuns += currentGame.runs; gameResults.push(currentGame.runs);
    elements.gamesSimulated.textContent = totalGames;
    elements.totalRuns.textContent = totalRuns;
    elements.avgRuns.textContent = (totalRuns / totalGames).toFixed(2);
    updateHistogram();
    updatePlayerStatsUI(); // Update individual stats after each game
    log(`Game ${totalGames} finished. Runs: ${currentGame.runs}`);
}

function playAtBat() {
    const batter = lineup[currentGame.batterIndex];

    // Initialize current game stats for this batter if not already
    if (batter.id && !currentGame.playerGameStats[batter.id]) {
        currentGame.playerGameStats[batter.id] = { PA: 0, 1B: 0, 2B: 0, 3B: 0, HR: 0, BB: 0, Outs: 0 };
    }

    const roll = Math.random() * 100;
    let accumulated = 0;
    let result = "Out";
    
    // Track PA
    if (batter.id) currentGame.playerGameStats[batter.id].PA++;

    if (roll < (accumulated += batter.bb)) {
        result = "BB";
        if (batter.id) currentGame.playerGameStats[batter.id].BB++;
    } else if (roll < (accumulated += batter.single)) {
        result = "1B";
        if (batter.id) currentGame.playerGameStats[batter.id]["1B"]++;
    } else if (roll < (accumulated += batter.double)) {
        result = "2B";
        if (batter.id) currentGame.playerGameStats[batter.id]["2B"]++;
    } else if (roll < (accumulated += batter.triple)) {
        result = "3B";
        if (batter.id) currentGame.playerGameStats[batter.id]["3B"]++;
    } else if (roll < (accumulated += batter.hr)) {
        result = "HR";
        if (batter.id) currentGame.playerGameStats[batter.id].HR++;
    } else {
        // It is an Out
        if (batter.id) currentGame.playerGameStats[batter.id].Outs++;
    }
    
    handleResult(result, batter.name);
    // Only use top 9 batters
    currentGame.batterIndex = (currentGame.batterIndex + 1) % 9;
}

function handleResult(result, batterName) {
    let runsScoredThisPlay = 0;
    if (result === "Out") {
        currentGame.outs++;
        log(`${batterName} Out.`);
        if (currentGame.outs >= 3) {
            log(`End of Inning ${currentGame.inning}.`);
            // On inning end, update cumulative player stats with stats from this game
            lineup.forEach(p => {
                if (p.id && currentGame.playerGameStats[p.id]) {
                    playerStats[p.id].PA += currentGame.playerGameStats[p.id].PA;
                    playerStats[p.id]["1B"] += currentGame.playerGameStats[p.id]["1B"];
                    playerStats[p.id]["2B"] += currentGame.playerGameStats[p.id]["2B"];
                    playerStats[p.id]["3B"] += currentGame.playerGameStats[p.id]["3B"];
                    playerStats[p.id].HR += currentGame.playerGameStats[p.id].HR;
                    playerStats[p.id].BB += currentGame.playerGameStats[p.id].BB;
                    playerStats[p.id].Outs += currentGame.playerGameStats[p.id].Outs;
                    // Only increment gamesPlayed once per game for players who actually had a PA
                    if (currentGame.playerGameStats[p.id].PA > 0) {
                        playerStats[p.id].gamesPlayed++;
                    }
                }
            });

            currentGame.outs = 0; currentGame.bases = [null, null, null]; currentGame.inning++;
            currentGame.playerGameStats = {}; // Reset player game stats for new inning
        }
    } else {
        let newBases = [...currentGame.bases];
        if (result === "BB") {
            log(`${batterName} walks.`);
            if (newBases[0] === null) newBases[0] = batterName;
            else if (newBases[1] === null) { newBases[1] = newBases[0]; newBases[0] = batterName; }
            else if (newBases[2] === null) { newBases[2] = newBases[1]; newBases[1] = newBases[0]; newBases[0] = batterName; }
            else { runsScoredThisPlay++; newBases[2] = newBases[1]; newBases[1] = newBases[0]; newBases[0] = batterName; }
        } else if (result === "1B") {
            log(`${batterName} hits a Single!`);
            if (newBases[2]) { runsScoredThisPlay++; newBases[2] = null; }
            if (newBases[1]) {
                if (Math.random() < 0.60) { runsScoredThisPlay++; newBases[1] = null; }
                else { newBases[2] = newBases[1]; newBases[1] = null; }
            }
            if (newBases[0]) {
                if (newBases[2] === null && Math.random() < 0.10) { newBases[2] = newBases[0]; newBases[0] = null; }
                else { newBases[1] = newBases[0]; newBases[0] = null; }
            }
            newBases[0] = batterName;
        } else if (result === "2B") {
            log(`${batterName} hits a Double!`);
            if (newBases[2]) { runsScoredThisPlay++; newBases[2] = null; }
            if (newBases[1]) {
                if (Math.random() < 0.45) { runsScoredThisPlay++; newBases[1] = null; }
                else { newBases[2] = newBases[0]; newBases[0] = null; }
            }
            newBases[1] = batterName;
        } else if (result === "3B") {
            log(`${batterName} hits a Triple!`);
            if (newBases[2]) { runsScoredThisPlay++; newBases[2] = null; }
            if (newBases[1]) { runsScoredThisPlay++; newBases[1] = null; }
            if (newBases[0]) { runsScoredThisPlay++; newBases[0] = null; }
            newBases[2] = batterName;
        } else if (result === "HR") {
            log(`${batterName} hits a HOME RUN!`);
            if (newBases[2]) runsScoredThisPlay++; if (newBases[1]) runsScoredThisPlay++; if (newBases[0]) runsScoredThisPlay++;
            runsScoredThisPlay++;
            newBases = [null, null, null];
        }
        currentGame.bases = newBases;
        currentGame.runs += runsScoredThisPlay;
        if (runsScoredThisPlay > 0) log(`${runsScoredThisPlay} run(s) scored!`);
    }
}

function updateUI() {
    elements.inningDisplay.textContent = currentGame.inning > 9 ? "F" : currentGame.inning;
    elements.outsDisplay.textContent = currentGame.outs;
    elements.runsDisplay.textContent = currentGame.runs;
    
    if (currentGame.bases[0]) elements.bases[0].classList.add("active"); else elements.bases[0].classList.remove("active");
    if (currentGame.bases[1]) elements.bases[1].classList.add("active"); else elements.bases[1].classList.remove("active");
    if (currentGame.bases[2]) elements.bases[2].classList.add("active"); else elements.bases[2].classList.remove("active");
}

function log(msg) {
    if (!elements.gameLog) return;
    const div = document.createElement("div");
    div.className = "log-entry";
    div.textContent = msg;
    elements.gameLog.appendChild(div);
    elements.gameLog.scrollTop = elements.gameLog.scrollHeight;
}

window.addEventListener("DOMContentLoaded", init);
