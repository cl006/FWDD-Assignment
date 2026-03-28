/**
 * @param {string} title
 * @param {string} msg 
 * @param {boolean} isPrompt 
 * @returns {Promise} 
 */
function showModal(title, msg, isPrompt = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        const inputContainer = document.getElementById('modalInputContainer');
        const inputField = document.getElementById('modalInput');

        document.getElementById('modalTitle').innerText = title;
        document.getElementById('modalMessage').innerText = msg;
        inputContainer.style.display = isPrompt ? 'block' : 'none';
        inputField.value = "";

        modal.style.display = 'flex';

        document.getElementById('modalConfirm').onclick = () => {
            modal.style.display = 'none';
            resolve(isPrompt ? inputField.value : true);
        };

        document.getElementById('modalCancel').onclick = () => {
            modal.style.display = 'none';
            resolve(null);
        };
    });
}

document.getElementById('exitBtn').onclick = async () => {
    const wantToEnd = await showModal("TERMINATE SESSION?", "Do you want to END the game permanently and record the time?");

    if (wantToEnd) {
        try {
            const response = await fetch('/end-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: roomSessionId })
            });
            const data = await response.json();
            if (data.success) {
                await showModal("GAME ENDED", "Final results recorded. Goodbye!");
                window.location.href = '/';
            }
        } catch (err) {
            console.error("Error:", err);
        }
    } else {
        const wantToLeave = await showModal("PAUSE GAME?", "Temporary leave the dashboard? (Players can stay)");

        if (wantToLeave) {
            window.location.href = '/';
        } else {
            console.log("Host chose to stay.");
        }
    }
};

document.getElementById('nextRoundBtn').onclick = async () => {
    const isFinished = await showModal("NEXT ROUND", "Does everyone finish their round?");

    if (isFinished === true) {
        const hostIdInput = await showModal("SECURITY CHECK", "Please enter Host User ID to confirm:", true);

        if (!hostIdInput) return;

        if (!roomSessionId) {
            await showModal("ERROR", "Session ID missing. Please refresh the page.");
            return;
        }

        try {
            const response = await fetch('/next-round-trigger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: roomSessionId,
                    hostId: hostIdInput
                })
            });

            const data = await response.json();

            if (data.success) {
                const inputField = document.getElementById('roundInput');
                if (inputField) {
                    inputField.value = data.newRound;

                    updateBottomButtons();
                }

                await showModal("SUCCESS", `Round ${data.newRound} has officially started!`);
            } else {
                await showModal("DENIED", data.message || "Unauthorized access.");
            }
        } catch (err) {
            console.error("Next Round Error:", err);
            await showModal("SYSTEM ERROR", "Connection failed. Please check your server status.");
        }
    }
};

async function openSpecialModal() {
    const modal = document.getElementById('specialCellModal');
    const container = document.getElementById('cellTableBody');

    modal.style.display = 'flex';
    container.innerHTML = '<div style="text-align:center; color:#D8B56A; padding:20px;">Loading...</div>';

    try {
        const response = await fetch(`/special-cells/${roomSessionId}`);
        const data = await response.json();

        if (data.success) {
            container.innerHTML = data.cells.map(item => `
                <div class="cell-row">
                    <span class="cell-name">${item.cell_no}</span>
                    <span class="code-red">${item.verify_code}</span>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error("Fetch Error:", err);
    }
}

function filterCells() {
    const query = document.getElementById('cellSearchInput').value.trim().toUpperCase();
    const rows = document.querySelectorAll('.cell-row');

    rows.forEach(row => {
        const cellNo = row.querySelector('.cell-name').innerText.toUpperCase();
        row.style.display = cellNo.includes(query) ? "flex" : "none";
    });
}

function closeSpecialModal() {
    document.getElementById('specialCellModal').style.display = 'none';
}

async function openTreasureModal() {
    const modal = document.getElementById('treasureModal');
    const container = document.getElementById('treasureTableBody');

    modal.style.display = 'flex';
    container.innerHTML = '<div style="text-align:center; color:#D8B56A; padding:20px;">SCANNING SENSORS...</div>';

    try {
        const response = await fetch(`/treasures/${roomSessionId}`);
        const data = await response.json();

        if (data.success) {
            container.innerHTML = data.treasures.map(item => {
                const statusText = item.is_real ? "REAL" : "FAKE";
                const statusColor = item.is_real ? "#2ecc71" : "#95a5a6";

                return `
                    <div class="cell-row treasure-row">
                        <div class="cell-name">
                            <span style="display:block; font-size:0.8rem; opacity:0.7;">${item.treasure_id}</span>
                            <span>${item.cell_code}</span>
                        </div>
                        <span style="color: ${statusColor}; font-weight: bold; font-family: 'Courier New';">${statusText}</span>
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        container.innerHTML = '<div style="color:red; text-align:center;">SCANNER ERROR</div>';
    }
}

function filterTreasures() {
    const query = document.getElementById('treasureSearchInput').value.trim().toUpperCase();
    const rows = document.querySelectorAll('.treasure-row');

    rows.forEach(row => {
        const text = row.innerText.toUpperCase();
        row.style.display = text.includes(query) ? "flex" : "none";
    });
}

function closeTreasureModal() {
    document.getElementById('treasureModal').style.display = 'none';
}

async function openShopModal() {
    const modal = document.getElementById('shopModal');
    const display = document.getElementById('displayShopCode');

    modal.style.display = 'flex';
    display.innerText = "....";

    try {
        const response = await fetch(`/shop-code/${roomSessionId}`);
        const data = await response.json();

        if (data.success) {
            display.innerText = data.shopCode;
        } else {
            display.innerText = "N/A";
        }
    } catch (err) {
        console.error("Shop Code Fetch Error:", err);
        display.innerText = "ERR";
    }
}

function closeShopModal() {
    document.getElementById('shopModal').style.display = 'none';
}

let monitorInterval;

function openMonitorModal() {
    document.getElementById('monitorModal').style.display = 'flex';
    updateMonitor(); // Initial load
    // Start real-time refresh every 3 seconds
    monitorInterval = setInterval(updateMonitor, 3000);
}

function closeMonitorModal() {
    document.getElementById('monitorModal').style.display = 'none';
    clearInterval(monitorInterval); // Stop refresh when closed
}

async function updateMonitor() {
    const round = document.getElementById('monitorRoundPicker').value;
    try {
        const response = await fetch(`/host/monitor/${roomSessionId}?round=${round}`);
        const result = await response.json();

        if (result.success) {
            const tbody = document.getElementById('monitorTableBody');

            if (result.data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Waiting for players to join...</td></tr>`;
                return;
            }

            tbody.innerHTML = result.data.map(p => `
                <tr>
                    <td>${p.player_id}</td>
                    <td><strong>${p.player_name}</strong></td>
                    <td>${p.cards_held || '<span style="color: #555">None</span>'}</td>
                    <td>${p.treasures_found || '<span style="color: #555">None</span>'}</td>
                    <td class="stat-real" style="color: ${p.real_count > 0 ? '#2ecc71' : '#555'}">${p.real_count}</td>
                    <td class="stat-fake" style="color: ${p.fake_count > 0 ? '#e74c3c' : '#555'}">${p.fake_count}</td>
                </tr>
            `).join('');

            const picker = document.getElementById('monitorRoundPicker');
            const currentOptionsCount = picker.options.length - 1;
            if (currentOptionsCount < result.currentRound) {
                for (let i = currentOptionsCount + 1; i <= result.currentRound; i++) {
                    picker.add(new Option(`Round ${i}`, i));
                }
            }
        }
    } catch (err) {
        console.error("Monitor refresh failed", err);
    }
}

async function confirmEndGame() {
    const isSure = await showModal("FINAL SETTLEMENT", "Are you sure you want to END the game? This will calculate rankings based on treasures and coins.", false);

    if (isSure) {
        try {
            const response = await fetch(`/end/${roomSessionId}`, { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                await showModal("GAME CONCLUDED", "Rankings have been calculated. Moving to the results hall...");
                window.location.href = `/results/${roomSessionId}`;
            } else {
                await showModal("ERROR", "Failed to finalize game data.");
            }
        } catch (err) {
            console.error("End game failed:", err);
            await showModal("SYSTEM ERROR", "Connection lost. Please check server console.");
        }
    }
}

function updateBottomButtons() {
    const roundInput = document.getElementById('roundInput');
    if (!roundInput) return;

    const currentRound = parseInt(roundInput.value);
    const exitBtn = document.getElementById('exitBtn');
    const endBtn = document.getElementById('endGameBtn');

    if (currentRound >= 7) {
        if (exitBtn) exitBtn.style.display = 'none';
        if (endBtn) endBtn.style.display = 'block';
    } else {
        if (exitBtn) exitBtn.style.display = 'block';
        if (endBtn) endBtn.style.display = 'none';
    }
}
document.addEventListener('DOMContentLoaded', () => {
    updateBottomButtons();

    const nextBtn = document.getElementById('nextRoundBtn');
});