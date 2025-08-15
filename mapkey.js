const express = require("express");
const config = require('./config')
const { expressjwt: jwt } = require('express-jwt')
const { expressJwtSecret } = require('jwks-rsa')
const axios = require('axios')

let router = express.Router();
module.exports = router;

let jwtCallback = jwt({
    credentialsRequired: false,
    secret: expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: config.sso.jwksUri
    }),
    algorithms: ['RS256']
});

router.get("/get", jwtCallback, async (req, res) => {
    res.cacheControl = {
        noCache: true
    };
    
    // Must either be logged in or have a valid Turnstile token
    if (req.auth) {
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
                res.json({mapTilerApiKey: config.mapTiler.apiKey});
                return;
            } else {
                console.error('Turnstile validation failed:', response.data['error-codes']);
            }
        } catch (error) {
            console.error('Turnstile validation error:', error);
        }
    }

    return res.status(401).send('Unable to verify SSO login or Captcha response').end();
});

module.exports = router;
