const { expressjwt: jwt } = require('express-jwt');
const { expressJwtSecret } = require('jwks-rsa');
const config = require('./config');

// Keycloak access tokens often set aud to "account" and identify the client in azp.
function tokenIsForClient(payload) {
	let audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (audiences.indexOf(config.sso.clientId) !== -1) {
		return true;
	}
	return payload.azp === config.sso.clientId;
}

function ssoJwt(options) {
	let middleware = jwt(Object.assign({
		secret: expressJwtSecret({
			cache: true,
			rateLimit: true,
			jwksRequestsPerMinute: 5,
			jwksUri: config.sso.jwksUri
		}),
		algorithms: ['RS256'],
		issuer: config.sso.issuer
	}, options));

	return (req, res, next) => {
		middleware(req, res, (err) => {
			if (err) {
				next(err);
				return;
			}
			if (req.auth && !tokenIsForClient(req.auth)) {
				res.status(401).end();
				return;
			}
			next();
		});
	};
}

module.exports = ssoJwt;
