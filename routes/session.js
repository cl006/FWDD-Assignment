const express = require('express');
const router = express.Router();

module.exports = (db) => {
    function formatId(prefix, num) {
        return prefix + num.toString().padStart(4, '0');
    }
    router.get('/get-next-host-id', async (req, res) => {
        try {
            const [rows] = await db.promise().execute(
                'SELECT host_user_id FROM game_session ORDER BY host_user_id DESC LIMIT 1'
            );

            let nextH = 1;
            if (rows.length > 0 && rows[0].host_user_id) {
                const lastId = rows[0].host_user_id;
                const numericPart = parseInt(lastId.replace(/[^\d]/g, ''));
                nextH = numericPart + 1;
            }
            res.json({ nextHostId: formatId('H', nextH) });
        } catch (err) {
            console.error("ID Fetch Error:", err);
            res.status(500).json({ error: "Could not retrieve Host ID" });
        }
    });

    router.get('/check-active-session', async (req, res) => {
        try {
            const currentUserId = req.session.user_id;
            if (!currentUserId) return res.json({ hasActive: false });
            const [rows] = await db.promise().execute(
                `SELECT session_access_code 
                 FROM game_session 
                 WHERE user_id = ? AND ended_at IS NULL LIMIT 1`,
                [currentUserId]
            );

            if (rows.length > 0) {
                res.json({ hasActive: true, code: rows[0].session_access_code });
            } else {
                res.json({ hasActive: false });
            }
        } catch (err) {
            console.error("CHECK ERROR:", err);
            res.status(500).json({ success: false });
        }
    });
    router.post('/create-session', async (req, res) => {
        try {
            const realUserId = req.session.user_id;
            const { maxPlayers } = req.body;

            if (!realUserId) return res.status(401).json({ success: false, message: "Please Login" });
            const [hRows] = await db.promise().execute('SELECT host_user_id FROM game_session ORDER BY host_user_id DESC LIMIT 1');
            let nextHNum = 1;
            if (hRows.length > 0 && hRows[0].host_user_id && hRows[0].host_user_id.startsWith('H')) {
                nextHNum = parseInt(hRows[0].host_user_id.substring(1)) + 1;
            }
            const logicalHostId = 'H' + nextHNum.toString().padStart(4, '0');
            const [sRows] = await db.promise().execute('SELECT session_id FROM game_session ORDER BY session_id DESC LIMIT 1');
            let nextSNum = 1;
            if (sRows.length > 0 && sRows[0].session_id) {
                nextSNum = parseInt(sRows[0].session_id.substring(1)) + 1;
            }
            const newSessionId = 'S' + nextSNum.toString().padStart(4, '0');

            const accessCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const shopCode = 'SHOP-' + accessCode;

            await db.promise().execute(
                `INSERT INTO game_session 
                (session_id, user_id, host_user_id, session_access_code, shop_access_code, created_at, round_number, max_players) 
                VALUES (?, ?, ?, ?, ?, NOW(), 0, ?)`,
                [newSessionId, realUserId, logicalHostId, accessCode, shopCode, maxPlayers]
            );

            res.json({ success: true, code: accessCode });

        } catch (err) {
            console.error("SQL Error:", err);
            res.status(500).json({ success: false, message: err.sqlMessage || "Database Error" });
        }
    });

    // --- 逻辑 D
    router.post('/start-game-trigger', async (req, res) => {
        const { sessionId } = req.body;
        const currentUserId = req.session.user_id;

        try {
            const [rooms] = await db.promise().execute(
                'SELECT user_id, max_players, started_at FROM game_session WHERE session_id = ?',
                [sessionId]
            );

            if (rooms.length === 0) return res.status(404).json({ success: false, message: "Room not found." });
            const room = rooms[0];
            if (room.user_id !== currentUserId) {
                return res.status(403).json({ success: false, message: "Unauthorized: Only Host can start." });
            }
            const [players] = await db.promise().execute(
                'SELECT COUNT(*) as count FROM players WHERE session_id = ?', [sessionId]
            );
            if (players[0].count < 2) {
                return res.json({ success: false, message: `At least 2 players required. (Current: ${players[0].count})` });
            }
            const [checkData] = await db.promise().execute(
                'SELECT COUNT(*) as count FROM special_cell_verification WHERE session_id = ?',
                [sessionId]
            );
            const hasData = checkData[0].count > 0;

            if (room.started_at !== null && hasData) {
                return res.json({ success: true, message: "Game restored." });
            }

            await db.promise().query('START TRANSACTION');

            try {
                if (!hasData) {
                    const [allCells] = await db.promise().execute(
                        'SELECT cell_code FROM cells WHERE cell_type = "Special"'
                    );

                    if (allCells.length === 0) {
                        throw new Error("Init Failed: No cells with type 'Special' found. Check your database.");
                    }

                    const outcomes = ['treasure', 'movement', 'swap', 'empty'];
                    const vInserts = allCells.map(c => [
                        sessionId,
                        c.cell_code,
                        Math.random().toString(36).substring(2, 6).toUpperCase(),
                        outcomes[Math.floor(Math.random() * outcomes.length)]
                    ]);

                    await db.promise().query(
                        'INSERT INTO special_cell_verification (session_id, cell_code, verify_code, outcome_type) VALUES ?',
                        [vInserts]
                    );

                    const [templates] = await db.promise().execute('SELECT treasure_id FROM treasures_map');
                    if (templates.length < 10) {
                        throw new Error(`Init Failed: Need at least 10 treasures in treasures_map. (Found: ${templates.length})`);
                    }

                    const shuffledT = [...templates].sort(() => 0.5 - Math.random());
                    const shuffledC = [...allCells].sort(() => 0.5 - Math.random()).slice(0, 10);

                    const tInserts = shuffledC.map((cell, i) => [
                        sessionId,
                        shuffledT[i].treasure_id,
                        cell.cell_code,
                        i < 5 ? 1 : 0
                    ]);

                    await db.promise().query(
                        'INSERT INTO session_treasures (session_id, treasure_id, cell_code, is_real) VALUES ?',
                        [tInserts]
                    );
                }

                await db.promise().execute(
                    `UPDATE game_session 
                     SET started_at = IFNULL(started_at, NOW()), round_number = 1 
                     WHERE session_id = ?`,
                    [sessionId]
                );

                await db.promise().query('COMMIT');
                console.log(`>>> SUCCESS: Session ${sessionId} world initialized.`);

            } catch (innerErr) {
                await db.promise().query('ROLLBACK');
                throw innerErr;
            }

            res.json({ success: true });

        } catch (err) {
            console.error("!!! START GAME CRITICAL ERROR !!!");
            console.error(err.message);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.get('/session-host/:code', async (req, res) => {
        try {
            const accessCode = req.params.code;
            const currentUserId = req.session.user_id;

            const [sessions] = await db.promise().execute(
                'SELECT * FROM game_session WHERE session_access_code = ?', [accessCode]
            );

            if (sessions.length === 0) return res.send("Room not found!");
            const sessionData = sessions[0];

            if (sessionData.user_id !== currentUserId) {
                return res.status(403).send("Unauthorized access. Only the host can view this page.");
            }

            res.render('session-host', {
                room: sessionData,
                roomCode: accessCode,
                username: req.session.username
            });
        } catch (err) {
            res.status(500).send("Internal Server Error");
        }
    });

    // --- 逻辑 F: 加入游戏 (包含登录、状态、1-12随机图及人数上限校验) ---
    router.post('/join-session', async (req, res) => {
        try {
            const { playerName, accessCode } = req.body;
            const currentUserId = req.session.user_id;

            if (!currentUserId) {
                return res.status(401).json({ success: false, message: "Please sign in first!" });
            }

            const [rooms] = await db.promise().execute(
                `SELECT session_id, user_id, started_at, ended_at, max_players 
                FROM game_session WHERE session_access_code = ?`,
                [accessCode.toUpperCase()]
            );

            if (rooms.length === 0) return res.json({ success: false, message: "Room not found!" });
            const room = rooms[0];

            if (room.ended_at !== null) {
                return res.json({ success: false, message: "This game has already ended." });
            }

            const [existing] = await db.promise().execute(
                'SELECT player_name FROM players WHERE session_id = ? AND user_id = ?',
                [room.session_id, currentUserId]
            );

            if (existing.length > 0) {
                const players_Name = existing[0].player_name;

                if (room.started_at === null) {
                    if (players_Name !== playerName) {
                        await db.promise().execute(
                            'UPDATE players SET player_name = ? WHERE session_id = ? AND user_id = ?',
                            [playerName, room.session_id, currentUserId]
                        );
                        console.log(`Player ${currentUserId} changed name to ${playerName}`);
                    }
                    return res.json({
                        success: true,
                        message: "Rejoining and updated name...",
                        alreadyJoined: true
                    });
                }

                else {
                    if (players_Name !== playerName) {
                        return res.json({
                            success: false,
                            message: `Game in progress! You must use your original name: "${players_Name}" to rejoin.`
                        });
                    }
                    return res.json({
                        success: true,
                        message: "Reconnecting to active game...",
                        alreadyJoined: true
                    });
                }
            }

            if (room.started_at !== null) {
                return res.json({ success: false, message: "Game already in progress. You cannot join now." });
            }

            if (currentUserId === room.user_id) {
                return res.json({ success: false, message: "You are the Host!" });
            }

            const [occupied] = await db.promise().execute(
                'SELECT img_id FROM players WHERE session_id = ?',
                [room.session_id]
            );
            const maxAllowed = room.max_players || 6;

            if (occupied.length >= maxAllowed) {
                return res.json({ success: false, message: `Room full (${maxAllowed} max).` });
            }

            const usedIds = occupied.map(row => row.img_id);
            let available = [];
            for (let i = 1; i <= 12; i++) {
                if (!usedIds.includes(i)) available.push(i);
            }
            const randomImgId = available[Math.floor(Math.random() * available.length)];

            const [pRows] = await db.promise().execute('SELECT player_id FROM players ORDER BY player_id DESC LIMIT 1');
            const nextP = pRows.length > 0 ? parseInt(pRows[0].player_id.substring(2)) + 1 : 1;

            await db.promise().execute(
                `INSERT INTO players (player_id, user_id, session_id, player_name, current_cell, coins, img_id) 
                VALUES (?, ?, ?, ?, 'Start', 100, ?)`,
                [formatId('PL', nextP), currentUserId, room.session_id, playerName, randomImgId]
            );

            res.json({ success: true });

        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: "Server error." });
        }
    });

    // --- 逻辑 G
    router.get('/session-player/:code', async (req, res) => {
        try {
            const accessCode = req.params.code;
            const currentUserId = req.session.user_id;

            if (!currentUserId) return res.redirect('/login');

            const [rows] = await db.promise().execute(
                `SELECT p.*, s.session_access_code, s.host_user_id
                FROM players p 
                JOIN game_session s ON p.session_id = s.session_id 
                WHERE s.session_access_code = ? AND p.user_id = ?`,
                [accessCode.toUpperCase(), currentUserId]
            );

            if (rows.length === 0) {
                return res.redirect('/');
            }

            res.render('session-player', {
                player: rows[0],
                room: {
                    session_id: rows[0].session_id,
                    user_id: rows[0].host_user_id
                },
                roomCode: accessCode,
                username: req.session.username
            });
        } catch (err) {
            console.error("Session Player Route Error:", err);
            res.status(500).send("Error loading player page");
        }
    });

    router.post('/end-session', async (req, res) => {
        try {
            const { sessionId } = req.body;
            const currentUserId = req.session.user_id;

            await db.promise().execute(
                'UPDATE game_session SET ended_at = NOW() WHERE session_id = ? AND user_id = ?',
                [sessionId, currentUserId]
            );
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false });
        }
    });

    // --- 逻辑 I
    router.get('/get-players/:sid', async (req, res) => {
        try {
            const [rows] = await db.promise().execute(
                'SELECT player_name, img_id FROM players WHERE session_id = ?',
                [req.params.sid]
            );
            res.json({ players: rows });
        } catch (err) {
            console.error("Fetch players error:", err);
            res.status(500).json({ players: [] });
        }
    });

    // --- 逻辑 J
    router.get('/check-game-status/:sid', async (req, res) => {
        try {
            const sessionId = req.params.sid;
            const [rows] = await db.promise().execute(
                'SELECT started_at, session_access_code FROM game_session WHERE session_id = ?',
                [sessionId]
            );

            if (rows.length > 0 && rows[0].started_at !== null) {
                res.json({
                    started: true,
                    roomCode: rows[0].session_access_code
                });
            } else {
                res.json({ started: false });
            }
        } catch (err) {
            res.json({ started: false });
        }
    });

    // --- 逻辑 K
    router.get('/game-start/:code', async (req, res) => {
        try {
            const currentUserId = req.session.user_id;
            const roomCodeParam = req.params.code;

            if (!currentUserId) return res.redirect('/login');

            const [rooms] = await db.promise().execute(
                'SELECT * FROM game_session WHERE session_access_code = ?',
                [roomCodeParam.toUpperCase()]
            );

            if (rooms.length === 0) return res.send("Room not found!");
            const roomData = rooms[0];

            if (roomData.ended_at !== null) {
                return res.send("This game session has already ended.");
            }

            if (currentUserId === roomData.user_id) {
                if (roomData.started_at === null) {
                    return res.render('session-host', {
                        room: roomData,
                        roomCode: roomCodeParam,
                        username: req.session.username
                    });
                } else {
                    return res.render('game-start-host', {
                        room: roomData,
                        roomCode: roomCodeParam,
                        username: req.session.username
                    });
                }
            } else {
                const [players] = await db.promise().execute(
                    'SELECT * FROM players WHERE session_id = ? AND user_id = ?',
                    [roomData.session_id, currentUserId]
                );

                if (players.length === 0) {
                    return res.send("You are not part of this session.");
                }

                if (roomData.started_at === null) {
                    return res.render('session-player', {
                        player: players[0],
                        room: roomData,
                        roomCode: roomCodeParam,
                        username: req.session.username
                    });
                } else {
                    return res.render('game-start-player', {
                        player: players[0],
                        room: roomData,
                        roomCode: roomCodeParam,
                        username: req.session.username
                    });
                }
            }
        } catch (err) {
            console.error("Game Start Route Error:", err);
            res.status(500).send("Error loading game page");
        }
    });

    // --- 逻辑 L
    router.delete('/exit-session', async (req, res) => {
        try {
            const { sessionId, userId } = req.body;

            const [result] = await db.promise().execute(
                'DELETE FROM players WHERE session_id = ? AND user_id = ?',
                [sessionId, userId]
            );

            if (result.affectedRows > 0) {
                res.json({ success: true, message: "Player removed successfully." });
            } else {
                res.json({ success: false, message: "No record found to delete." });
            }
        } catch (err) {
            console.error("Exit Session Error:", err);
            res.status(500).json({ success: false, message: "Server error during exit." });
        }
    });

    return router;
};