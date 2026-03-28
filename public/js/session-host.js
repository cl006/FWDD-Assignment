document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('qrCanvas');
    const exitBtn = document.getElementById('exitBtn');
    const startBtn = document.getElementById('startBtn');

    if (canvas) {
        const joinUrl = `${window.location.origin}/?joinCode=${ROOM_CODE}`;
        console.log("the code url", joinUrl);

        QRCode.toCanvas(canvas, joinUrl, {
            width: 150,
            margin: 2,
            color: {
                dark: "#D8B56A",
                light: "#FFFFFF"
            }
        }, (error) => {
            if (error) console.error("二维码生成失败:", error);
        });
    }

    async function updatePlayerList() {
        try {
            const res = await fetch(`/get-players/${SESSION_ID}`);
            const data = await res.json();

            const players = data.players;
            const maxSlots = 6;

            const titleEl = document.querySelector('.title-group h1');
            if (titleEl) {
                titleEl.innerText = `Players Joined: ${players.length}`;
            }

            for (let i = 1; i <= maxSlots; i++) {
                const slot = document.getElementById(`slot-${i}`);
                const player = players[i - 1];

                if (player) {
                    if (!slot.classList.contains('occupied') || slot.dataset.playerId !== player.player_name) {
                        slot.classList.add('occupied');
                        slot.dataset.playerId = player.player_name;

                        slot.innerHTML = `
                            <img src="/images/${player.img_id}.png" class="slot-bg-img">
                            <div class="name-label">${player.player_name}</div>
                        `;
                    }
                } else {
                    if (slot.classList.contains('occupied') || slot.innerHTML === "") {
                        slot.classList.remove('occupied');
                        slot.removeAttribute('data-player-id');
                        slot.innerHTML = `<span class="waiting-text">Waiting...</span>`;
                    }
                }
            }
        } catch (err) {
            console.error("real-time upadate failed:", err);
        }
    }

    const pollInterval = setInterval(updatePlayerList, 2000);

    if (exitBtn) {
        exitBtn.onclick = async () => {
            if (confirm("Are you sure you want to close this session? All players will be kicked.")) {
                try {
                    const res = await fetch('/end-session', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sessionId: SESSION_ID })
                    });
                    if (res.ok) {
                        clearInterval(pollInterval);
                        window.location.href = '/';
                    }
                } catch (err) {
                    alert("Failed to end session");
                }
            }
        };
    }

    if (startBtn) {
        startBtn.onclick = async () => {
            try {
                const res = await fetch('/start-game-trigger', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: SESSION_ID })
                });
                const data = await res.json();
                if (data.success) {
                    clearInterval(pollInterval);
                    window.location.href = `/game-start/${ROOM_CODE}`;
                } else {
                    alert("Could not start game. Ensure players have joined.");
                }
            } catch (err) {
                alert("Error starting game");
            }
        };
    }
});