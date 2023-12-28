const express = require("express");
const {body, validationResult} = require('express-validator');
const config = require('./config')
var { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");
const db = require("./db");
const summitUtils = require('./summits');

let router = express.Router();
module.exports = router;

let jwtCallback = jwt({
    secret: jwksRsa.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: config.sso.jwksUri
    }),
    algorithms: ['RS256']
});

const DB_COLLECTION_USERS = "users";

router.get("/me", jwtCallback, (req, res) => {
    const reqUserId = req.user.userid;
    if (!reqUserId) {
        return res.status(401).send("Missing userid in SSO token").end();
    }

    db.getDb().collection(DB_COLLECTION_USERS).findOne({userid: reqUserId}, (err, user) => {
        if (err) {
            return res.status(500).end();
        }

        if (!user) {
            return res.status(404).end();
        }

        let summitObjectList = user.userSummits.map(userSummit => {
            userSummit.summit = {code: userSummit.code};
            delete userSummit.code;
            return userSummit;
        })
        summitUtils.lookupSummits(summitObjectList)
            .then(userDataWithSummits => {
                user.userSummits = userDataWithSummits;
                return res.json(user);
            });
    });
});

router.post("/me/settings",
    jwtCallback,
    (req, res) => {

        const reqUserId = req.user.userid;
        if (!reqUserId) {
            return res.status(401).send("Missing userid in SSO token").end();
        }

        const newSettings = Object.fromEntries(Object.entries(req.body).map(([k, v]) => ['settings.' + k, v]));

        db.getDb().collection(DB_COLLECTION_USERS).updateOne(
            {userid: reqUserId},
            {$set: newSettings},
            {upsert: true}
        );

        return res.status(200).end();
    });

router.get("/me/tags", jwtCallback, (req, res) => {
    const reqUserId = req.user.userid;
    if (!reqUserId) {
        return res.status(401).send("Missing userid in SSO token").end();
    }

    db.getDb().collection(DB_COLLECTION_USERS).aggregate([
        { $match: {userid: reqUserId} },
        { $unwind: '$userSummits' },
        { $unwind: '$userSummits.tags' },
        { $match: { 'userSummits.tags': { $not: {$size: 0}  }}},
        { $group: { _id: '$userSummits.tags', count: { $sum: 1 } } }
    ]).toArray().then(tagList => {
        if(!tagList || tagList.length === 0) {
            return res.json([]);
        }

        return res.json(tagList.map(tagItem => {
            return {tag: tagItem._id, count: tagItem.count}
        }));
    }).catch(() => {
        return res.status(500).end();
    })
});

router.get("/me/summits/tags", jwtCallback, (req, res) => {
    const reqUserId = req.user.userid;
    if (!reqUserId) {
        return res.status(401).send("Missing userid in SSO token").end();
    }

    let queryParam = req.query.q ? req.query.q : []
    if(!Array.isArray(queryParam)) {
        queryParam = [queryParam];
    }

    db.getDb().collection(DB_COLLECTION_USERS).aggregate([
        { $match: {userid: reqUserId} },
        { $unwind: '$userSummits' },
        { $match: { 'userSummits.tags': { $in: queryParam } }},
        { $group: { _id: '$userid', codes: { $push: '$userSummits.code' } } }
    ]).toArray().then(summitCodeList => {
        if (!summitCodeList || summitCodeList.length !== 1 ||
            !summitCodeList[0].codes || summitCodeList[0].codes.length === 0) {
            return res.json([]);
        }

        let summitObjectList = summitCodeList[0].codes.map(code => {
            return {summit: {code: code}};
        });
        summitUtils.lookupSummits(summitObjectList)
            .then(lookedUpSummits => {

                return res.json(lookedUpSummits.map(lookedUpSummit => {return lookedUpSummit.summit}));
            })
    }).catch(err => {
        return res.status(500).end();
    })
});

router.get("/me/summit/:association/:code", jwtCallback, (req, res) => {
    const reqUserId = req.user.userid;
    if (!reqUserId) {
        return res.status(401).send("Missing userid in SSO token").end();
    }

    const code = req.params.association + "/" + req.params.code
    db.getDb().collection(DB_COLLECTION_USERS).aggregate([
        { $match: {userid: reqUserId} },
        { $unwind: '$userSummits' },
        { $match: { 'userSummits.code': { $in: [code] } }},
        { $project: { _id: '$userid', userSummit: '$userSummits' } }
    ]).toArray().then(userSummits => {
        if (!userSummits || userSummits.length === 0) {
           return res.json({
               summit: {code: code},
               isBookmarked: false,
               notes: "",
               tags: []
           })
        }

        if(userSummits.length !== 1) {
           return res.status(500).end()
        }

        summitUtils.lookupSummits([{summit: {code: userSummits[0].userSummit.code}}])
            .then(summitDetails => {
                let requestedUserSummit = userSummits[0];
                delete requestedUserSummit.userSummit.code;
                requestedUserSummit.userSummit.summit = summitDetails[0].summit;
                return res.json(requestedUserSummit.userSummit);
            })
    }).catch(err => {
        return res.status(500).end();
    });
});

router.post("/me/summit/:association/:code",
    jwtCallback,
    body("isBookmarked").isBoolean(),
    body("notes").optional().trim().default(""),
    body("tags").isArray(),
    body("tags.*").isString(),
    (req, res) => {

        const reqUserId = req.user.userid;
        if (!reqUserId) {
            return res.status(401).send("Missing userid in SSO token").end();
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({errors: errors.array()});
        }

        const code = req.params.association + "/" + req.params.code
        const newSummitData = {
            code,
            isBookmarked: req.body.isBookmarked,
            notes: req.body.notes,
            tags: req.body.tags
        };

        db.getDb().collection(DB_COLLECTION_USERS).updateOne(
            {userid: reqUserId},
            {$pull: {userSummits: {code}}}
        );

        if (newSummitData.isBookmarked === true || newSummitData.notes !== "" || newSummitData.tags.length > 0) {
            db.getDb().collection(DB_COLLECTION_USERS).updateOne(
                {userid: reqUserId},
                {$push: {userSummits: newSummitData}},
                {upsert: true}
            );
            return res.status(201).end();
        } else {
            return res.status(204).end();
        }
    });
