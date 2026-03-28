document.addEventListener('DOMContentLoaded', () => {
    let syncInterval = null;

    async function updateWaitingRoom() {
        try {
            const res = await fetch(`/get-players/${SESSION_ID}`);
            const data = await res.json();
            const listEl = document.getElementById('playersList');

            if (listEl) {
                listEl.innerHTML = '';
                data.players.forEach(p => {
                    const pill = document.createElement('div');
                    pill.className = 'player-pill';
                    pill.innerHTML = `
                        <img src="/images/${p.img_id}.png" class="pill-bg-img">
                        <span class="pill-name">${p.player_name}</span>
                    `;
                    listEl.appendChild(pill);
                });
            }

            const statusRes = await fetch(`/check-game-status/${SESSION_ID}`);
            const statusData = await statusRes.json();

            if (statusData && statusData.started) {

                if (syncInterval) clearInterval(syncInterval);

                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.style.display = 'flex';
                }

                setTimeout(() => {
                    window.location.href = `/game-start/${statusData.roomCode}`;
                }, 1200);
            }
        } catch (err) {
            console.error("Sync error:", err);
        }
    }

    syncInterval = setInterval(updateWaitingRoom, 2000);

    const exitBtn = document.getElementById('exitBtn');
    if (exitBtn) {
        exitBtn.onclick = async () => {
            const sure = confirm("Are you sure you want to exit? Your progress will be DELETED from the server.");

            if (sure) {
                try {
                    const response = await fetch('/exit-session', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sessionId: SESSION_ID,
                            userId: MY_USER_ID
                        })
                    });

                    const result = await response.json();
                    if (result.success) {
                        window.location.href = '/';
                    } else {
                        alert("Could not exit: " + (result.message || "Unknown error"));
                    }
                } catch (err) {
                    console.error("Exit request failed:", err);
                    alert("Network error. Could not delete your session.");
                }
            }
        };
    }
});