const express = require('express');
const router = express.Router();

module.exports = (db) => {
    router.get('/login', (req, res) => {
        res.render('login', { title: 'Login' });
    });

    router.post('/login', (req, res) => {
        const { user_email, password } = req.body;

        const sql = "SELECT * FROM users WHERE user_email = ?";

        db.query(sql, [user_email], (err, results) => {
            if (err) {
                console.error("Database error:", err);
                return res.status(500).send("Internal Server Error");
            }

            if (results.length > 0) {
                const user = results[0];

                if (user.password === password) {
                    req.session.username = user.username;
                    req.session.loggedin = true;
                    req.session.user_id = results[0].user_id;

                    req.session.save((err) => {
                        if (err) {
                            console.error("Session save error:", err);
                            return res.status(500).send("Error saving session");
                        }
                        console.log("Session saved for:", user.username);
                        res.redirect('/');
                    });
                } else {
                    res.render('login', { error: 'Invalid password. Please try again.' });
                }
            } else {
                res.render('login', { error: 'Email not found. Please register first.' });
            }
        });
    });

    return router;
};