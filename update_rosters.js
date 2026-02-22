const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

// 1. Configuration
const TEAMS = [
    { id: 1, name: "Angels", key: "angels" },
    { id: 2, name: "Orioles", key: "orioles" },
    { id: 3, name: "Red Sox", key: "redsox" },
    { id: 4, name: "White Sox", key: "whitesox" },
    { id: 5, name: "Guardians", key: "guardians" },
    { id: 6, name: "Tigers", key: "tigers" },
    { id: 7, name: "Royals", key: "royals" },
    { id: 8, name: "Twins", key: "twins" },
    { id: 9, name: "Yankees", key: "yankees" },
    { id: 10, name: "Athletics", key: "athletics" },
    { id: 11, name: "Mariners", key: "mariners" },
    { id: 12, name: "Rays", key: "rays" },
    { id: 13, name: "Rangers", key: "rangers" },
    { id: 14, name: "Blue Jays", key: "bluejays" },
    { id: 15, name: "Diamondbacks", key: "diamondbacks" },
    { id: 16, name: "Braves", key: "braves" },
    { id: 17, name: "Cubs", key: "cubs" },
    { id: 18, name: "Reds", key: "reds" },
    { id: 19, name: "Rockies", key: "rockies" },
    { id: 20, name: "Marlins", key: "marlins" },
    { id: 21, name: "Astros", key: "astros" },
    { id: 22, name: "Dodgers", key: "dodgers" },
    { id: 23, name: "Brewers", key: "brewers" },
    { id: 24, name: "Nationals", key: "nationals" },
    { id: 25, name: "Mets", key: "mets" },
    { id: 26, name: "Phillies", key: "phillies" },
    { id: 27, name: "Pirates", key: "pirates" },
    { id: 28, name: "Cardinals", key: "cardinals" },
    { id: 29, name: "Padres", key: "padres" },
    { id: 30, name: "Giants", key: "giants" }
];

// 2. Load Player Database (for IDs)
let playerDb = [];
try {
    const rawDb = fs.readFileSync('players.json', 'utf8');
    const jsonDb = JSON.parse(rawDb);
    playerDb = jsonDb.people.map(p => ({
        id: p.id,
        name: p.fullName,
        normName: normalizeName(p.fullName)
    }));
    console.log(`Loaded ${playerDb.length} players from database.`);
} catch (e) {
    console.error("Error loading players.json. Run 'curl ... > players.json' first.");
    process.exit(1);
}

function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findPlayerId(name) {
    const norm = normalizeName(name);
    // Exact match
    let match = playerDb.find(p => p.normName === norm);
    if (match) return match.id;
    
    // Fuzzy/Partial match (e.g. "Pete Alonso" vs "Peter Alonso" - actually MLB usually has full names)
    // Or accents: "Julio Rodriguez" vs "Julio Rodríguez"
    // My normalizeName removes accents if I used a better regex, but [^a-z0-9] keeps simple.
    // Let's try to strip accents for robust matching.
    const deaccent = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const normDeaccent = normalizeName(deaccent(name));
    
    match = playerDb.find(p => normalizeName(deaccent(p.name)) === normDeaccent);
    if (match) return match.id;
    
    // Last resort: Includes
    // match = playerDb.find(p => p.normName.includes(norm) || norm.includes(p.normName));
    // Risky (e.g. "Will Smith" pitcher vs catcher). Avoid for now.
    
    return null;
}

// 3. Scraper Function
function fetchTeamData(team) {
    return new Promise((resolve) => {
        const url = `https://www.fangraphs.com/depthcharts.aspx?position=ALL&teamid=${team.id}`;
        console.log(`Fetching ${team.name}...`);
        
        // Use curl because node https usually fails with complex sites/cookies/headers without effort
        exec(`curl -L "${url}"`, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Failed to fetch ${team.name}`);
                resolve(null);
                return;
            }
            
            try {
                const roster = parseFanGraphsHTML(stdout);
                resolve({ key: team.key, name: team.name, roster });
            } catch (e) {
                console.error(`Failed to parse ${team.name}: ${e.message}`);
                resolve(null);
            }
        });
    });
}

function parseFanGraphsHTML(html) {
    // Very basic regex parsing because full DOM parser is not available in standard node without JSDOM
    // We look for the "ALL Batters" table or aggregated projections.
    // Actually, looking at the previous output, the "ALL Batters" table structure is:
    // <a name="ALL" href="#ALL">ALL Batters</a>... <table ...> ... </table>
    
    // Strategy: Find the "ALL Batters" anchor, then find the next table.
    // Then parse rows.
    
    // Extract table content
    const allBattersMarker = 'name="ALL" href="#ALL">ALL Batters</a>';
    let split = html.split(allBattersMarker);
    if (split.length < 2) return [];
    
    let tablePart = split[1].split('</table>')[0];
    
    // Rows
    const players = [];
    const rowRegex = /<tr class="depth_(?:reg|alt)">(.*?)<\/tr>/gs;
    let rowMatch;
    
    while ((rowMatch = rowRegex.exec(tablePart)) !== null) {
        const rowHtml = rowMatch[1];
        
        // Extract Name
        const nameMatch = />([^<]+)<\/a>/; 
        const nameExec = nameMatch.exec(rowHtml);
        if (!nameExec) continue;
        const name = nameExec[1];
        
        // Extract Stats (TDs)
        // Format: PA, AVG, OBP, SLG, wOBA, ...
        // Regex to get cell contents
        const cellRegex = /<td[^>]*>(.*?)<\/td>/g;
        const cells = [];
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
            // strip tags from cell content
            cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
        }
        
        // Expected indices (based on previous output):
        // 0: Name (handled)
        // 1: PA
        // 2: AVG
        // 3: OBP
        // 4: SLG
        
        if (cells.length < 5) continue;
        
        const pa = parseInt(cells[1]) || 0;
        const avg = parseFloat(cells[2]) || 0;
        const obp = parseFloat(cells[3]) || 0;
        const slg = parseFloat(cells[4]) || 0;
        
        if (pa < 10) continue; // Skip noise
        
        // Position estimation?
        // The name in the link usually has &position=...
        // <a href="statss.aspx?playerid=...&position=OF">
        const posMatch = /position=([^"]+)"/;
        const posExec = posMatch.exec(rowHtml);
        const pos = posExec ? posExec[1] : '';
        
        players.push({ name, pos, pa, avg, obp, slg });
    }
    
    // Sort by PA descending
    players.sort((a, b) => b.pa - a.pa);
    
    // Take top ~13
    const topPlayers = players.slice(0, 13);
    
    // Convert to Simulator Format
    return topPlayers.map(p => {
        // Calculations
        // BB% = (OBP - AVG) / (1 - AVG)
        let bbRate = 0;
        if (p.avg < 1) bbRate = (p.obp - p.avg) / (1 - p.avg);
        
        // 1-BB% (AB rate per PA)
        const abRate = 1 - bbRate;
        
        // ISO = SLG - AVG
        const iso = p.slg - p.avg;
        
        // Estimated XBH rates per AB (League avg distributions adjusted)
        // HR approx 15-18% of ISO? No, usually HR/AB is 3-6%. ISO .150-.200.
        // Let's use the ratios derived earlier:
        // HR_rate (per AB) ~ ISO * 0.17
        // 2B_rate (per AB) ~ ISO * 0.40
        // 3B_rate (per AB) ~ ISO * 0.04
        // These are heuristic approximations
        
        let hrRateAB = Math.max(0, iso * 0.17);
        let doubleRateAB = Math.max(0, iso * 0.40);
        let tripleRateAB = Math.max(0, iso * 0.04);
        
        // 1B_rate (per AB) = AVG - (HR + 2B + 3B)
        let singleRateAB = Math.max(0, p.avg - (hrRateAB + doubleRateAB + tripleRateAB));
        
        // Convert to Percentages of PA
        const bb = bbRate * 100;
        const single = singleRateAB * abRate * 100;
        const double = doubleRateAB * abRate * 100;
        const triple = tripleRateAB * abRate * 100;
        const hr = hrRateAB * abRate * 100;
        
        // Find ID
        const id = findPlayerId(p.name);
        
        return {
            id: id,
            name: `${p.name} (${p.pos})`,
            single: parseFloat(single.toFixed(1)),
            double: parseFloat(double.toFixed(1)),
            triple: parseFloat(triple.toFixed(1)),
            hr: parseFloat(hr.toFixed(1)),
            bb: parseFloat(bb.toFixed(1))
        };
    });
}

// 4. Main Execution
async function run() {
    console.log("Starting scrape for all 30 teams...");
    
    const finalData = {};
    
    // Run sequentially to be polite/safe
    for (const team of TEAMS) {
        const data = await fetchTeamData(team);
        if (data) {
            finalData[data.key] = data.roster;
        }
    }
    
    // Generate simulator.js
    // Read existing to keep code, replace teamData
    const currentFile = fs.readFileSync('simulator.js', 'utf8');
    
    const startMarker = 'const teamData = {';
    const endMarker = '};';
    
    // We need to find the FIRST closing brace after the start marker that closes the object
    // Simple replacement: We constructed the file so teamData is at the top.
    
    const newDataString = `const teamData = ${JSON.stringify(finalData, null, 4)};`;
    
    // Using a regex to replace the variable declaration block
    // Assuming teamData is the first block.
    // Be careful not to replace the whole file.
    
    // Safer: Construct the file from scratch using the template part?
    // Or just use the known structure.
    
    // Let's use a robust replace
    const fileParts = currentFile.split('// State');
    if (fileParts.length < 2) {
        console.error("Could not parse simulator.js structure.");
        return;
    }
    
    const newFileContent = `// Team Data
${newDataString}

// State${fileParts[1]}`;

    fs.writeFileSync('simulator.js', newFileContent);
    console.log("Done! simulator.js updated with 30 teams.");
}

run();
