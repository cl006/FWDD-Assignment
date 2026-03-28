let selectedItemId = null;
let currentItems = [];

async function initShop() {
    try {
        let url = `/shop-items/${SHOP_TYPE}?session=${SESSION_ID}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            currentItems = data.items;
            renderItems();
        }
    } catch (err) {
        console.error("Load failed", err);
    }
}

function renderItems() {
    const container = document.getElementById('itemsContainer');
    container.innerHTML = currentItems.map(item => `
        <div class="shop-card" onclick="selectItem('${item.id}', this)">
            <img class="card-img" src="${item.img || '/images/default-item.png'}" />
            <div class="card-info">
                <h3>${item.name}</h3>
                <p class="price">${item.price} Coins</p>
                <p style="font-size:0.7rem; color:#666;">${item.description || ''}</p>
            </div>
        </div>
    `).join('');
}

function selectItem(id, el) {
    selectedItemId = id;
    document.querySelectorAll('.shop-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
}

//4. purchase
async function processPurchase() {
    if (!selectedItemId) return alert("Please select a treasure first!");
    const btn = document.querySelector('.btn-purchase');
    const selectedCard = document.querySelector('.shop-card.selected');
    const treasureName = selectedCard ? selectedCard.querySelector('h3').innerText : "The treasure";
    console.log("Purchase Initialized:", {
        sessionId: SESSION_ID,
        itemId: selectedItemId,
        shopType: SHOP_TYPE
    });

    btn.disabled = true;
    btn.innerText = "Processing...";

    try {
        const res = await fetch('/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: SESSION_ID,
                itemId: selectedItemId,
                shopType: SHOP_TYPE
            })
        });

        const result = await res.json();

        if (result.success) {
            const coinEl = document.getElementById('coinCount');
            if (coinEl) {
                coinEl.innerText = result.newBalance;
            }

            let msg = "Item purchased successfully!";
            if (SHOP_TYPE === 'clue' && result.clueData) {
                msg = `📜 NEW CLUE REVEALED!\n\n${treasureName}\nis hidden between Cell ${result.clueData.min} and ${result.clueData.max}.\n\n(This has been saved to your BAG)`;
            }

            alert(msg);

            setTimeout(() => {
                window.location.href = `/game-start-player/${SESSION_ID}`;
            }, 800);

        } else {
            alert("Error: " + result.message);
            btn.disabled = false;
            btn.innerText = "PURCHASE";
        }

    } catch (err) {
        console.error("Purchase failed:", err);
        alert("Connection Error: Could not reach the server.");
        btn.disabled = false;
        btn.innerText = "PURCHASE";
    }
}

function renderItems() {
    const container = document.getElementById('itemsContainer');
    if (!container) return;

    container.innerHTML = currentItems.map(item => {
        if (SHOP_TYPE === 'card' || SHOP_TYPE === 'movement') {
            const isNegative = item.description.includes('-');
            const badgeColor = isNegative ? '#ff4757' : '#2ed573';
            const badgeText = isNegative ? 'DEBUFF' : 'BUFF';

            return `
                <div class="shop-card card-item-style" onclick="selectItem('${item.id}', this)" style="border-top: 6px solid ${item.color || '#ccc'}">
                    <div class="card-visual" style="background: ${item.color}22;">
                        <span class="card-emoji">${item.icon || '📦'}</span>
                    </div>
                    <div class="card-info">
                        <span class="type-badge" style="background:${badgeColor}">${badgeText}</span>
                        <h3>${item.name}</h3>
                        <p class="price">${item.price} Coins</p>
                        <p class="desc">${item.description}</p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="shop-card" onclick="selectItem('${item.id}', this)">
                <div class="img-container">
                    <img class="card-img" src="${item.img}" onerror="this.src='/images/default_treasure.png'" />
                </div>
                <div class="card-info">
                    <h3>${item.name}</h3>
                    <p class="price">${item.price} Coins</p>
                    <p class="desc">${item.description || 'Click to buy a location clue'}</p>
                </div>
            </div>
        `;
    }).join('');
}

function scrollShop(dir) {
    document.getElementById('itemsContainer').scrollBy({ left: dir * 250, behavior: 'smooth' });
}

initShop();