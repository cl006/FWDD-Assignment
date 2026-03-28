module.exports = (db) => {
    const express = require('express');
    const router = express.Router();

    /**
     * --- HELPER: Clue Text Generator ---
     * Generates variety in clue descriptions to make the game more interesting.
     */
    function generateClueHint(cellCode) {
        const cellNum = parseInt(cellCode.replace('C', ''));
        const randomType = Math.random();

        if (randomType < 0.4) {
            // Type 1: Regional Hint
            return cellNum <= 36
                ? "Intelligence: The treasure is buried in the **Northern territories**."
                : "Intelligence: The treasure is buried in the **Southern territories**.";
        } else if (randomType < 0.7) {
            // Type 2: Parity Hint
            return cellNum % 2 === 0
                ? "Hint: Ancient scrolls suggest the cell number is **Even**."
                : "Hint: Ancient scrolls suggest the cell number is **Odd**.";
        } else {
            // Type 3: Last Digit Hint
            const lastDigit = cellNum % 10;
            return `Rumor: A traveler mentions the cell code ends with the digit **${lastDigit}**.`;
        }
    }

    // 3. Get Game Status (Synchronize Round Number)
    router.get('/get-game-status/:sessionId', async (req, res) => {
        try {
            const [rows] = await db.promise().execute(
                'SELECT round_number, started_at FROM game_session WHERE session_id = ?',
                [req.params.sessionId]
            );
            if (rows.length === 0) return res.status(404).json({ error: "Session not found" });
            res.json(rows[0]);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/submit-verification', async (req, res) => {
        const { sessionId, cellCode, verifyCode } = req.body;
        const cleanCell = cellCode.trim().toUpperCase();

        try {
            const [cellRows] = await db.promise().execute(
                'SELECT cell_type FROM cells WHERE cell_code = ?',
                [cleanCell]
            );

            if (cellRows.length === 0) {
                return res.json({ success: false, message: "This cell doesn't appear in the maps" });
            }

            const dbCellType = cellRows[0].cell_type; // 例如: 'Card Shop', 'Clue Shop', 'Special'

            if (dbCellType.includes('Shop')) {
                const [sessionRows] = await db.promise().execute(
                    'SELECT shop_access_code FROM game_session WHERE session_id = ?',
                    [sessionId]
                );

                if (sessionRows.length > 0 && sessionRows[0].shop_access_code.toString() === verifyCode.toString()) {

                    let shopType = 'general';
                    if (dbCellType === 'Clue Shop') shopType = 'clue';
                    if (dbCellType === 'Card Shop') shopType = 'card';
                    if (dbCellType === 'Movement Shop') shopType = 'movement';

                    return res.json({
                        success: true,
                        outcome: 'SHOP',
                        shopType: shopType,
                        message: `Welcome enter to ${dbCellType}!`
                    });
                } else {
                    return res.json({ success: false, message: "This shop verification cannot used." });
                }
            }

            else {
                const [verifyRows] = await db.promise().execute(
                    `SELECT outcome_type FROM special_cell_verification 
                    WHERE session_id = ? AND cell_code = ? AND verify_code = ?`,
                    [sessionId, cleanCell, verifyCode.toUpperCase()]
                );

                if (verifyRows.length === 0) {
                    return res.json({ success: false, message: "Cell or verify code wrong!" });
                }

                const outcome = verifyRows[0].outcome_type.toUpperCase();
                let redirectType = 'EASY';
                let isReal = false;

                switch (outcome) {
                    case 'TREASURE':
                        const [tRows] = await db.promise().execute(
                            'SELECT is_real FROM session_treasures WHERE session_id = ? AND cell_code = ?',
                            [sessionId, cleanCell]
                        );
                        isReal = tRows.length > 0 && tRows[0].is_real;
                        redirectType = 'HARD';
                        break;
                    case 'SWAP':
                        redirectType = 'MEDIUM';
                        break;
                    case 'MOVEMENT':
                        redirectType = 'EASY';
                        break;
                    case 'EMPTY':
                        redirectType = 'NONE';
                        break;
                }

                res.json({
                    success: true,
                    outcome: outcome,
                    isReal: isReal,
                    redirectType: redirectType,
                    message: `触发事件: ${outcome}`
                });
            }

        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: "Sever issues" });
        }
    });

    router.get('/question-page/:sessionId', async (req, res) => {
        const sessionId = req.params.sessionId;
        const userId = req.session.user_id;

        if (!userId) return res.redirect('/login');

        try {
            const [rows] = await db.promise().execute(
                'SELECT player_id FROM players WHERE session_id = ? AND user_id = ?',
                [sessionId, userId]
            );

            const playerId = rows.length > 0 ? rows[0].player_id : null;
            if (!playerId) return res.redirect('/');

            res.render('question-page', {
                level: req.query.level || 'Easy',
                cellCode: req.query.cell || '',
                sessionId: sessionId,
                playerId: playerId
            });
        } catch (err) {
            console.error(err);
            res.status(500).send("Player Data Error");
        }
    });

    router.get('/get-questions', async (req, res) => {
        let { level, count } = req.query;

        let dbLevel = level ? level.trim() : 'Easy';
        dbLevel = dbLevel.charAt(0).toUpperCase() + dbLevel.slice(1).toLowerCase();
        if (dbLevel === 'Hard') dbLevel = 'Challenge';

        const limitCount = parseInt(count) || 1;

        try {
            const qSql = `SELECT question_id, question_text, explanation, level 
                        FROM questions WHERE level = ? ORDER BY RAND() LIMIT ?`;

            const [qRows] = await db.promise().query(qSql, [dbLevel, limitCount]);

            if (qRows.length === 0) {
                return res.json({ success: false, message: `No questions found for ${dbLevel}` });
            }

            const questionsWithChoices = await Promise.all(qRows.map(async (q) => {
                const [cRows] = await db.promise().query(
                    "SELECT choice_id, choice_text, is_answer FROM question_choices WHERE question_id = ?",
                    [q.question_id]
                );
                return { ...q, choices: cRows };
            }));

            console.log(`Loaded ${questionsWithChoices.length} questions.`);
            res.json({ success: true, questions: questionsWithChoices });

        } catch (err) {
            console.error("Backend SQL Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/submit-attempt', async (req, res) => {
        const { playerId, sessionId, questionId, selectedChoiceId, isCorrect, mode, level, cellCode } = req.body;

        try {
            const insertAttemptSql = `
                INSERT INTO question_attempts 
                (player_id, session_id, question_id, selected_choice_id, answered_round) 
                VALUES (?, ?, ?, ?, (SELECT round_number FROM game_session WHERE session_id = ?))`;

            await db.promise().execute(insertAttemptSql, [
                playerId, sessionId, questionId, selectedChoiceId, sessionId
            ]);

            if (!isCorrect) {
                return res.json({ success: true, correct: false });
            }

            let coinsToAdd = 0;
            let earnedItems = [];
            let treasureAlreadyLooted = false;
            const lowerLevel = level ? level.toLowerCase() : '';

            if (mode === 'SPECIAL' && cellCode) {
                const [tRes] = await db.promise().query(
                    "SELECT treasure_id FROM session_treasures WHERE cell_code = ? AND session_id = ?",
                    [cellCode, sessionId]
                );

                if (tRes.length > 0) {
                    const targetTreasureId = tRes[0].treasure_id;

                    const [fRes] = await db.promise().query(
                        "SELECT player_id FROM found_treasures WHERE treasure_id = ? AND session_id = ?",
                        [targetTreasureId, sessionId]
                    );

                    if (fRes.length > 0) {
                        treasureAlreadyLooted = true;
                    } else {
                        await db.promise().execute(
                            `INSERT INTO found_treasures (player_id, session_id, treasure_id, found_round) 
                            VALUES (?, ?, ?, (SELECT round_number FROM game_session WHERE session_id = ?))`,
                            [playerId, sessionId, targetTreasureId, sessionId]
                        );
                    }
                }
            }

            if (mode === 'SPECIAL') {
                if (lowerLevel === 'easy') coinsToAdd = 20;
                else if (lowerLevel === 'middle' || lowerLevel === 'medium') coinsToAdd = 50;
                else coinsToAdd = 100;
            } else {
                coinsToAdd = (lowerLevel === 'easy') ? 30 : 70;
            }

            if (!treasureAlreadyLooted) {
                let dropChance = 0;
                if (mode === 'ROUND') {
                    dropChance = (lowerLevel === 'challenge') ? 0.6 : 0.1;
                } else if (mode === 'SPECIAL') {
                    dropChance = 0.4;
                }

                if (Math.random() < dropChance) {
                    const loot = ['Verify Card', 'Swap Card', 'Movement Card'];
                    const rewardType = loot[Math.floor(Math.random() * loot.length)];

                    let cardValue = (rewardType === 'Movement Card') ? (Math.floor(Math.random() * 3) + 1) : 1;

                    await db.promise().execute(
                        `INSERT INTO player_cards (player_id, card_type, quantity, card_value, obtained_round) 
                        VALUES (?, ?, 1, ?, (SELECT round_number FROM game_session WHERE session_id = ?)) 
                        ON DUPLICATE KEY UPDATE quantity = quantity + 1, card_value = GREATEST(card_value, ?)`,
                        [playerId, rewardType, cardValue, sessionId, cardValue]
                    );

                    earnedItems.push({ name: rewardType, value: cardValue });
                }
            }

            await db.promise().execute('UPDATE players SET coins = coins + ? WHERE player_id = ?', [coinsToAdd, playerId]);

            const [rows] = await db.promise().execute('SELECT coins FROM players WHERE player_id = ?', [playerId]);
            const totalCoins = rows[0].coins;

            const io = req.app.get('socketio');
            if (io) {
                io.to(sessionId).emit('update-coins', { playerId: playerId, newCoins: totalCoins });
            }
            res.json({
                success: true,
                correct: true,
                coinsEarned: coinsToAdd,
                itemsEarned: earnedItems,
                message: treasureAlreadyLooted ? "Treasure already claimed by another player!" : "Success!"
            });

        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: "Already answered!" });
            console.error("Reward Error:", err);
            res.status(500).json({ success: false, message: "Server error" });
        }
    });

    router.get('/question-level/:sessionId', async (req, res) => {
        const { sessionId } = req.params;
        const { mode, round } = req.query;
        res.render('question-level', {
            sessionId: sessionId,
            mode: mode || 'ROUND',
            round: round || 1
        });
    });

    router.get('/game-start-player/:sessionId', async (req, res) => {
        const { sessionId } = req.params;
        const userId = req.session.user_id;

        if (!userId) return res.redirect('/login');

        try {
            const [rooms] = await db.promise().query(
                'SELECT * FROM game_session WHERE session_id = ?',
                [sessionId]
            );
            const [players] = await db.promise().query(
                'SELECT * FROM players WHERE session_id = ? AND user_id = ?',
                [sessionId, userId]
            );
            if (rooms.length === 0 || players.length === 0) {
                console.error("❌ Data not found for:", sessionId);
                return res.redirect('/');
            }
            res.render('game-start-player', {
                room: rooms[0],
                player: players[0]
            });

        } catch (err) {
            console.error("❌ Backend 500 Error:", err);
            res.status(500).send("Render Error: " + err.message);
        }
    });

    router.get('/player-stats/:sessionId', async (req, res) => {
        const { sessionId } = req.params;
        const userId = req.session.user_id;
        try {
            const [players] = await db.promise().query(
                'SELECT coins FROM players WHERE session_id = ? AND user_id = ?',
                [sessionId, userId]
            );
            if (players.length > 0) {
                res.json({ success: true, coins: players[0].coins });
            } else {
                res.status(404).json({ success: false });
            }
        } catch (err) {
            res.status(500).json({ success: false });
        }
    });

    router.get('/shop/:sessionId', async (req, res) => {
        const { sessionId } = req.params;
        const shopType = req.query.type || 'clue';

        try {
            const [player] = await db.promise().query(
                "SELECT coins FROM players WHERE user_id = ? AND session_id = ?",
                [req.session.userId, sessionId]
            );

            res.render('shop', {
                shopTitle: shopType.toUpperCase() + " SHOP",
                shopType: shopType,
                sessionId: sessionId,
                playerCoins: player[0] ? player[0].coins : 0
            });
        } catch (err) {
            res.redirect('/game-start-player');
        }
    });

    const treasureImageMap = {
        'The Kings Seal Ring': 'kings_seal_ring.jpg',
        'Crusaders Shield': 'crusaders_shield.jpg',
        'Alchemists Grimoire': 'alchemists_grimoire.jpg',
        'Golden Chalice': 'golden_chalice.jpg',
        'Dragon-Engraved Dagger': 'dragon_dagger.jpg',
        'Pouch of Gold Florins': 'gold_florins.jpg',
        'The Iron Crown': 'iron_crown.jpg',
        'Bishops Medallion': 'bishops_medallion.jpg',
        'Sealed Land Deed': 'land_deed.jpg',
        'Jeweled Candelabra': 'candelabra.jpg'
    };

    router.get('/shop-items/clue', async (req, res) => {
        const { session } = req.query;

        if (!session) {
            return res.status(400).json({ success: false, message: "Missing session ID" });
        }

        try {
            const [treasures] = await db.promise().query(
                `SELECT tm.treasure_id AS id, tm.treasure_name AS name
                FROM session_treasures st
                JOIN treasures_map tm ON st.treasure_id = tm.treasure_id
                WHERE st.session_id = ?`,
                [session]
            );
            const items = treasures.map(t => {
                const fileName = treasureImageMap[t.name] || 'default_treasure.png';

                return {
                    id: t.id,
                    name: t.name,
                    img: `/images/${fileName}`,
                    price: 50,
                    description: 'Click to buy a location clue'
                };
            });

            res.json({ success: true, items: items });

        } catch (err) {
            console.error("Shop API Error:", err);
            res.status(500).json({ success: false, message: "Database Error" });
        }
    });

    const movementItems = [
        { id: 'MOVE_P1', name: 'Swift Boots', icon: '👟', color: '#2ecc71', price: 10, description: 'Add +1 step to your next move.' },
        { id: 'MOVE_P2', name: 'Silver Wing', icon: '💸', color: '#3498db', price: 20, description: 'Add +2 steps to your next move.' },
        { id: 'MOVE_P3', name: 'Golden Chariot', icon: '🏎️', color: '#f1c40f', price: 35, description: 'Add +3 steps to your next move.' },

        { id: 'MOVE_M1', name: 'Rusty Chain', icon: '⛓️', color: '#e67e22', price: 8, description: 'Reduce -1 step from next move.' },
        { id: 'MOVE_M2', name: 'Heavy Ankle', icon: '⚓', color: '#e74c3c', price: 15, description: 'Reduce -2 steps from next move.' },
        { id: 'MOVE_M3', name: 'Mud Trap', icon: '🌫️', color: '#95a5a6', price: 25, description: 'Reduce -3 steps from next move.' }
    ];

    router.get('/shop-items/movement', async (req, res) => {
        res.json({ success: true, items: movementItems });
    });

    router.post('/purchase', async (req, res) => {
        const { sessionId, itemId, shopType } = req.body;
        const sessionUser = req.session.username;

        try {
            const [playerRows] = await db.promise().query(
                `SELECT p.player_id, p.coins, s.round_number 
                FROM players p 
                JOIN game_session s ON p.session_id = s.session_id
                JOIN users u ON p.user_id = u.user_id 
                WHERE u.username = ? AND p.session_id = ?`,
                [sessionUser, sessionId]
            );

            if (playerRows.length === 0) return res.status(404).json({ success: false, message: "Player not found" });

            const player = playerRows[0];
            const actualPlayerId = player.player_id;
            const currentRound = player.round_number;
            const price = (shopType === 'clue') ? 20 : 30;

            if (player.coins < price) return res.json({ success: false, message: "Not enough coins!" });

            let clueData = null;

            if (shopType === 'clue') {
                const [posRows] = await db.promise().query(
                    "SELECT cell_code FROM session_treasures WHERE session_id = ? AND treasure_id = ?",
                    [sessionId, itemId]
                );

                if (posRows.length > 0) {
                    const realIndex = parseInt(posRows[0].cell_code.replace(/[^0-9]/g, ''));
                    const min = realIndex - (Math.floor(Math.random() * 4) + 7);
                    const max = realIndex + (Math.floor(Math.random() * 6) + 5);
                    const clueText = `Coordinates: Between Cell ${min} and ${max}`;
                    const generatedClueId = 'C' + Date.now().toString().slice(-4);

                    await db.promise().query(
                        `INSERT INTO player_clues (clue_id, player_id, session_id, treasure_id, clue_text, source, obtained_round) 
                        VALUES (?, ?, ?, ?, ?, 'Shop', ?)`,
                        [generatedClueId, actualPlayerId, sessionId, itemId, clueText, currentRound]
                    );
                    clueData = { min, max };
                }
            }
            else if (shopType === 'movement' || shopType === 'card') {
                let effectValue = 0;
                if (itemId.includes('_P')) effectValue = parseInt(itemId.slice(-1));
                else if (itemId.includes('_M')) effectValue = -parseInt(itemId.slice(-1));
                else if (itemId === 'CARD_MOVE') effectValue = 2;

                await db.promise().query(
                    `INSERT INTO player_cards (player_id, card_type, card_value, quantity, obtained_round) 
                    VALUES (?, ?, ?, 1, ?)`,
                    [actualPlayerId, itemId, effectValue, currentRound]
                );
            }

            await db.promise().query(
                "UPDATE players SET coins = coins - ? WHERE player_id = ?",
                [price, actualPlayerId]
            );

            res.json({
                success: true,
                newBalance: player.coins - price,
                clueData: clueData
            });

        } catch (err) {
            console.error("🔥 Server Error:", err.message);
            res.status(500).json({ success: false, message: "Database error: " + err.message });
        }
    });

    router.get('/shop-items/card', async (req, res) => {
        try {
            const cards = [
                {
                    id: 'CARD_MOVE',
                    name: 'Movement Card',
                    color: '#e67e22',
                    icon: '🏃',
                    price: 15,
                    description: 'Add +2 steps to your next move.'
                },
                {
                    id: 'CARD_SWAP',
                    name: 'Swap Card',
                    color: '#9b59b6',
                    icon: '🔄',
                    price: 25,
                    description: 'Swap positions with a random player.'
                },
                {
                    id: 'CARD_VERIFY',
                    name: 'Verify Card',
                    color: '#27ae60',
                    icon: '🔍',
                    price: 30,
                    description: 'Check if a treasure is in your current cell.'
                }
            ];
            res.json({ success: true, items: cards });
        } catch (err) {
            res.status(500).json({ success: false });
        }
    });

    // --- New Route: Render Level Selection Page ---
    router.get('/level-selection/:roomCode', (req, res) => {
        res.render('question-level', { roomCode: req.params.roomCode });
    });

    router.get('/play', (req, res) => {
        const { type } = req.query;

        const sql = "SELECT room_code FROM game_session WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1";

        db.query(sql, (err, results) => {
            if (err || results.length === 0) return res.redirect('/');

            const roomCode = results[0].room_code;

            const redirectUrl = `/join/${roomCode}?auto=${type || 'special'}`;
            res.redirect(redirectUrl);
        });
    });

    router.get('/get-inventory/:sessionId', async (req, res) => {
        const { sessionId } = req.params;
        const sessionUser = req.session.username;
        const sessionPlayerName = req.session.playerName;

        console.log(`🎒 Bag Request - Session User: ${sessionUser}, Player: ${sessionPlayerName}`);

        if (!sessionUser && !sessionPlayerName) {
            return res.status(401).json({ success: false, message: "Unauthorized: Please log in." });
        }

        try {
            const [playerRows] = await db.promise().query(
                `SELECT p.player_id, p.player_name 
                FROM players p
                JOIN users u ON p.user_id = u.user_id
                WHERE (u.username = ? OR p.player_name = ?) AND p.session_id = ?`,
                [sessionUser, sessionPlayerName, sessionId]
            );

            if (playerRows.length === 0) {
                return res.status(404).json({ success: false, message: "Player not found in this session." });
            }

            const playerId = playerRows[0].player_id;
            const actualName = playerRows[0].player_name;

            const [cards] = await db.promise().query(
                "SELECT card_type, quantity, card_value FROM player_cards WHERE player_id = ?",
                [playerId]
            );

            const [clues] = await db.promise().query(
                "SELECT clue_text, source FROM player_clues WHERE player_id = ? AND session_id = ?",
                [playerId, sessionId]
            );

            const [treasures] = await db.promise().query(
                `SELECT tm.treasure_name 
                FROM found_treasures ft 
                JOIN treasures_map tm ON ft.treasure_id = tm.treasure_id 
                WHERE ft.player_id = ? AND ft.session_id = ?`,
                [playerId, sessionId]
            );
            res.json({
                success: true,
                playerName: actualName,
                cards: cards,
                clues: clues,
                treasures: treasures
            });

        } catch (err) {
            console.error("SQL Error in Bag:", err);
            res.status(500).json({ success: false, message: "Database Error" });
        }
    });

    router.post('/next-round-trigger', (req, res) => {
        const { sessionId, hostId } = req.body;
        console.log("Checking Session:", sessionId, "Input HostId:", hostId);
        const checkSql = "SELECT host_user_id FROM game_session WHERE session_id = ?";

        db.query(checkSql, [sessionId], (err, results) => {
            if (err) return res.json({ success: false, message: "DB Error: " + err.message });
            if (results.length === 0) {
                return res.json({ success: false, message: "Session not found in Database" });
            }
            const dbHostId = results[0].host_user_id;

            if (!dbHostId || dbHostId.toString() !== hostId.toString()) {
                return res.json({ success: false, message: "Invalid Host ID. Unauthorized action." });
            }
            const updateSql = "UPDATE game_session SET round_number = round_number + 1 WHERE session_id = ?";
            db.query(updateSql, [sessionId], (err) => {
                if (err) return res.json({ success: false, message: "Update Error" });
                const getNewSql = "SELECT round_number FROM game_session WHERE session_id = ?";
                db.query(getNewSql, [sessionId], (err, roundResults) => {
                    res.json({
                        success: true,
                        newRound: roundResults[0].round_number
                    });
                });
            });
        });
    });

    router.get('/special-cells/:sessionId', (req, res) => {
        const sessionId = req.params.sessionId;
        const sql = "SELECT cell_code AS cell_no, verify_code FROM special_cell_verification WHERE session_id = ?";

        db.query(sql, [sessionId], (err, results) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, cells: results });
        });
    });

    router.get('/treasures/:sessionId', (req, res) => {
        const sessionId = req.params.sessionId;
        const sql = `
            SELECT treasure_id, cell_code, is_real 
            FROM session_treasures 
            WHERE session_id = ?
        `;

        db.query(sql, [sessionId], (err, results) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, treasures: results });
        });
    });

    router.get('/shop-code/:sessionId', (req, res) => {
        const sessionId = req.params.sessionId;
        const sql = "SELECT shop_access_code FROM game_session WHERE session_id = ?";

        db.query(sql, [sessionId], (err, results) => {
            if (err || results.length === 0) return res.json({ success: false, message: "Not found" });
            res.json({ success: true, shopCode: results[0].shop_access_code });
        });
    });

    router.get('/host/monitor/:sessionId', async (req, res) => {
        const { sessionId } = req.params;
        const roundFilter = req.query.round;

        try {
            const [sessionInfo] = await db.promise().query(
                "SELECT round_number FROM game_session WHERE session_id = ?", [sessionId]
            );

            let query = `
                SELECT 
                    p.player_id, 
                    p.player_name,
                    (SELECT GROUP_CONCAT(CONCAT(card_type, ' (', card_value, ')') SEPARATOR ', ') 
                    FROM player_cards 
                    WHERE player_id = p.player_id 
                    ${roundFilter ? 'AND obtained_round = ' + db.escape(roundFilter) : ''}
                    ) as cards_held,
                    (SELECT GROUP_CONCAT(treasure_id SEPARATOR ', ') 
                    FROM found_treasures 
                    WHERE player_id = p.player_id 
                    ${roundFilter ? 'AND found_round = ' + db.escape(roundFilter) : ''}
                    ) as treasures_found,
                    (SELECT COUNT(*) FROM found_treasures ft 
                    JOIN session_treasures st ON ft.treasure_id = st.treasure_id AND ft.session_id = st.session_id
                    WHERE ft.player_id = p.player_id AND st.is_real = 1
                    ) as real_count,
                    (SELECT COUNT(*) FROM found_treasures ft 
                    JOIN session_treasures st ON ft.treasure_id = st.treasure_id AND ft.session_id = st.session_id
                    WHERE ft.player_id = p.player_id AND st.is_real = 0
                    ) as fake_count
                FROM players p
                WHERE p.session_id = ?`;

            const [monitorData] = await db.promise().query(query, [sessionId]);

            res.json({
                success: true,
                currentRound: sessionInfo[0] ? sessionInfo[0].round_number : 1,
                data: monitorData
            });
        } catch (err) {
            console.error("Monitor API Error:", err);
            res.status(500).json({ success: false });
        }
    });

    // 在 routes/game.js 内部
    router.post('/end-session', (req, res) => {
        const { sessionId } = req.body;

        // SQL：更新状态为 ended，并记录当前时间
        const sql = "UPDATE game_session SET status = 'ended', ended_at = NOW() WHERE session_id = ?";

        db.query(sql, [sessionId], (err, result) => {
            if (err) {
                console.error("Database Error:", err);
                return res.status(500).json({ success: false, message: err.message });
            }
            res.json({ success: true, message: "Game finalized successfully." });
        });
    });

    router.post('/end/:sessionId', async (req, res) => {
        const { sessionId } = req.params;
        const now = new Date();

        try {
            // 1. Update session to set ended_at
            await db.promise().query(
                "UPDATE game_session SET ended_at = ? WHERE session_id = ?",
                [now, sessionId]
            );

            // 2. The Mega Ranking Query
            // Rule: Fake Treasure = 90 Coins. 
            // Winner Priority: 1. Real Treasures Found, 2. Total Coins (Adjusted)
            const [rankings] = await db.promise().query(`
                SELECT 
                    p.player_id, 
                    p.player_name,
                    p.coins as base_coins,
                    -- Count Real Treasures
                    (SELECT COUNT(*) FROM found_treasures ft 
                    JOIN session_treasures st ON ft.treasure_id = st.treasure_id AND ft.session_id = st.session_id
                    WHERE ft.player_id = p.player_id AND st.is_real = 1) as real_treasures,
                    -- Count Fake Treasures
                    (SELECT COUNT(*) FROM found_treasures ft 
                    JOIN session_treasures st ON ft.treasure_id = st.treasure_id AND ft.session_id = st.session_id
                    WHERE ft.player_id = p.player_id AND st.is_real = 0) as fake_treasures,
                    -- Calculate Total Score (Base Coins + 90 per Fake)
                    (p.coins + ( (SELECT COUNT(*) FROM found_treasures ft 
                                JOIN session_treasures st ON ft.treasure_id = st.treasure_id AND ft.session_id = st.session_id
                                WHERE ft.player_id = p.player_id AND st.is_real = 0) * 90)
                    ) as final_score,
                    -- Question Stats
                    (SELECT COUNT(*) FROM question_attempts WHERE player_id = p.player_id) as total_questions,
                    (SELECT COUNT(*) FROM question_attempts qa
                    JOIN question_choices qc ON qa.selected_choice_id = qc.choice_id
                    WHERE qa.player_id = p.player_id AND qc.is_answer = 1) as correct_answers
                FROM players p
                WHERE p.session_id = ?
                ORDER BY real_treasures DESC, final_score DESC
            `, [sessionId]);

            res.json({ success: true, rankings });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false });
        }
    });

    router.get('/results/:sessionId', async (req, res) => {
        const { sessionId } = req.params;

        try {
            const [rankings] = await db.promise().query(`
                SELECT 
                    p.player_id, 
                    p.player_name, 
                    p.coins as base_coins, 
                    p.img_id, 
                    (SELECT COUNT(*) FROM found_treasures ft 
                    JOIN session_treasures st ON ft.treasure_id = st.treasure_id AND ft.session_id = st.session_id
                    WHERE ft.player_id = p.player_id AND ft.session_id = ? AND st.is_real = 1) as real_treasures,
                    (SELECT COUNT(*) FROM found_treasures ft 
                    JOIN session_treasures st ON ft.treasure_id = st.treasure_id AND ft.session_id = st.session_id
                    WHERE ft.player_id = p.player_id AND ft.session_id = ? AND st.is_real = 0) as fake_treasures,
                    (p.coins + (SELECT COUNT(*) FROM found_treasures ft 
                                JOIN session_treasures st ON ft.treasure_id = st.treasure_id AND ft.session_id = st.session_id
                                WHERE ft.player_id = p.player_id AND ft.session_id = ? AND st.is_real = 0) * 90) as final_score,
                    (SELECT COUNT(*) FROM question_attempts WHERE player_id = p.player_id AND session_id = ?) as total_q,
                    (SELECT COUNT(*) FROM question_attempts qa
                    JOIN question_choices qc ON qa.selected_choice_id = qc.choice_id
                    WHERE qa.player_id = p.player_id AND qa.session_id = ? AND qc.is_answer = 1) as correct_q
                FROM players p
                WHERE p.session_id = ?
                ORDER BY real_treasures DESC, final_score DESC
            `, [sessionId, sessionId, sessionId, sessionId, sessionId, sessionId]);

            res.render('results', {
                sessionId,
                rankings,
                winner: rankings[0]
            });
        } catch (err) {
            console.error("Results Error:", err);
            res.redirect('/');
        }
    });

    return router;
};