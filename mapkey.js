const express = require("express");
const config = require('./config')
const ssoJwt = require('./sso');
const axios = require('axios')

let router = express.Router();
module.exports = router;

let jwtCallback = ssoJwt({
    credentialsRequired: false
});

router.get("/get", jwtCallback, async (req, res) => {
    res.cacheControl = {
        noCache: true
    };
    
    // Must either be logged in or have a valid Turnstile token
    if (req.auth) {
        console.log('Request for MapTiler key with SSO login from user ' + req.auth.userid);
        res.json({mapTilerApiKey: config.mapTiler.apiKey});
        return;
    }

    if (req.query.token) {
        try {
            const params = {
                secret: config.turnstile.secretKey,
                response: req.query.token,
                remoteip: req.ip
            };
            const response = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', params);
            if (response.data.success) {
                console.log('Request for MapTiler key with successful Captcha response from ' + req.ip);
                res.json({mapTilerApiKey: config.mapTiler.apiKey});
                return;
            } else {
                console.error('Turnstile validation failed:', response.data['error-codes']);
            }
        } catch (error) {
            console.error('Turnstile validation error:', error);
        }
    }

    console.error('Request for MapTiler key without SSO login or Captcha response from ' + req.ip);
    return res.status(401).send('Unable to verify SSO login or Captcha response').end();
});

module.exports = router;
