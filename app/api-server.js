'use strict';

var express = require('express');
var serveStatic = require('serve-static');
var bodyParser = require('body-parser')
var cookieParser = require('cookie-parser');

var unless = require('express-unless');
var randomWords = require('random-words');
var Sentencer = require('sentencer');
var fs = require('fs');

//database
const MongoClient = require('mongodb').MongoClient;

const dotenv = require('dotenv');

//file uploading helpers
var multer = require('multer');
var upload = multer({ dest: 'uploads/' });

//auth/token stuff
var jwt = require('jsonwebtoken');

// Crypto to generate UUIDs
const { v4: uuidv4 } = require('uuid');

// PRIVATE and PUBLIC key
var privateKey = fs.readFileSync('./keys/private.key', 'utf8');
var publicKey = fs.readFileSync('./keys/public.key', 'utf8');

//create express server and register global middleware
//API7 - Express adds powered-by header which gives away internal information.
var api = express();
api.use(bodyParser.json());
api.use(bodyParser.urlencoded({
	extended: true
}));

api.use(cookieParser());

//accept files in /uploads dir (pictures)
api.use(serveStatic(__dirname + '/uploads'));
//api.use(serveStatic(__dirname + '/public'));

//API binds to interface pixiapp:8090
api.listen(8090, function () {
	if (process.env.NODE_ENV === undefined)
		process.env.NODE_ENV = 'development';
	console.log("PixiApp: API running on port %d in %s mode.", this.address().port, process.env.NODE_ENV);
});

// Connect to MongoDB

dotenv.config();
//const mongo_url = process.env.MONGO_URL;
const mongo_url = "mongodb://pixidb:27017";
console.log('API Server starting - Will connect to Mongo on: ' + mongo_url);

// Mongo V3 Driver separates url from dbname / uses client
const db_name = 'Pixidb'
let db

MongoClient.connect(mongo_url, { useNewUrlParser: true }, (err, client) => {
	if (err) return err;
	// Store the database connection object
	db = client.db(db_name)
	console.log(`>>> Connected to MongoDB: ${mongo_url}`)
	console.log(`>>> Database is: ${db_name}`)
})

function api_authenticate(user, pass, req, res) {
	console.log('>>> Logging user ' + user + ' with password: ' + pass);
	const users = db.collection('users');

	users.findOne({ email: user, password: pass }, function (err, result) {
		if (err) {
			console.log('>>> Query error...');
			return err;
		}
		if (result !== null) {
			// API10: This is bad logging, as it dumps the full user record
			console.log('>>> Found User:  ' + result);
			var user_profile = result;
			// API7/API3: Add full record to JWT token (including clear password)
			var payload = { user_profile };

			var token = jwt.sign(payload, privateKey, {
				algorithm: 'RS384',
				issuer: 'https://issuer.42crunch.demo',
				subject: user,
				expiresIn: "30m",
				audience: 'pixiUsers'
			});

			res.json({ message: "Token is a header JWT", token: token });
		}
		else
			res.status(401).json({ message: 'sorry pal, invalid login' });
	});
}

function api_register(user, pass, req, res) {
	console.log('>>> Registering user: ' + user + ' with password: ' + pass);

	const users = db.collection('users');
	// Check if user exists first
	users.findOne({ email: user }, function (err, result) {
		if (err) { return err; }
		if (result !== null) {
			// Bad message: the error message should not indicate what the error is.
			res.status(400).json({ "message": "user is already registered" });
		}
		else {
			if (req.body.is_admin) {
				var admin = true;
			}
			else {
				var admin = false
			}
			var name = req.body.name;
			var subject = user;
			console.log(">>> Username: " + name);
			// Voluntary error to return an exception is the account_balance is negative.
			if (req.body.account_balance < 0) {
				var err = new Error().stack;
				res.status(400).json(err);
				return;
			}
			var payload = {
				_id: uuidv4(),
				email: user,
				password: pass,
				name: name,
				account_balance: req.body.account_balance,
				is_admin: admin,
				all_pictures: [],
				onboarding_date: new Date()
			};
			// forceServerObjectId forces Mongo to use the specified _id instead of generating a random one.
			users.insertOne(payload, { forceServerObjectId: true }, function (err, user) {
				if (err) { res.status(500).json(err); return; }
				if (user != null) {
					var user_profile = payload;
					var jwt_payload = { user_profile };
					var token = jwt.sign(jwt_payload, privateKey, {
						algorithm: 'RS384',
						issuer: 'https://42crunch.com',
						subject: subject,
						expiresIn: "30m",
						audience: 'pixiUsers'
					});
					res.status(200).json({ message: "x-access-token", token: token, _id: payload._id });
				} //if user

			}) //insert
		} // else
	});
}

function api_token_check(req, res, next) {

	console.log('>>> Inbound token: ' + JSON.stringify(req.headers['x-access-token']));
	var token = req.headers['x-access-token'];

	// decode jwt token
	if (token) {
		// Verify token
		jwt.verify(token, publicKey, function (err, user) {
			if (err) {
				console.log(err)
				return res.json({ success: false, message: 'Failed to authenticate token' });
			} else {
				// if everything is good, save to request for use in other routes
				req.user = user;
				console.log('>>> Authenticated User: ' + JSON.stringify(req.user));
				next();
			}
		});

	} else {
		// if there is no token
		// return an error
		return res.status(403).send({
			success: false,
			message: 'No token provided'
		});
	}
}

function random_sentence() {
	var samples = ["This day was {{ adjective }} and {{ adjective }} for {{ noun }}",
		"The {{ nouns }} {{ adjective }} back! #YOLO",
		"Today's breakfast, {{ an_adjective }}, {{ adjective }} for {{ noun }} #instafood",
		"Oldie but goodie! {{ a_noun }} and {{ a_noun }} {{ adjective }} {{ noun }} #TBT",
		"My {{ noun }} is {{ an_adjective }}, {{ adjective}} and {{ adjective }} which is better than yours #IRL #FOMO ",
		"That time when your {{ noun }} feels {{ adjective }} and {{ noun }} #FML"
	];


	var my_sentence = samples[Math.floor(Math.random() * (4 - 1)) + 1];

	var sentencer = Sentencer.make(my_sentence);
	return sentencer;
}

api.delete('/api/picture/:pictureid', api_token_check, function (req, res) {
	console.log('>>> Deleting picture ' + req.params.pictureid);
	const pictures = db.collection('pictures');
	// BOLA - API1 Issue here: a user can delete someone's else picture.
	// Code does not validate who the picture belongs too.
	pictures.remove({ _id: Number(req.params.pictureid) },
		function (err, delete_photo) {
			if (err) { return err }
			//console.log(delete_photo);
			if (!delete_photo) {
				res.status(400).json({ "message": "photo not found" });
			}
			else {
				console('Photo ' + req.params.pictureid + ' deleted');
				res.status(202).json({ "message": "success" });
			}
			db.close();
		})
});

api.delete('/api/admin/user/:id', api_token_check, function (req, res) {
	console.log('>>> Deleting user ' + req.params.id);
	const users = db.collection('users');
	if (!req.params.id) {
		res.status(400).json({ "message": "missing userid to delete" });
	}
	else {
		// API2 : Authorization issue - This call should enforce admin role, but it does not.
		users.deleteOne({ _id: req.params.id },
			function (err, delete_user) {
				if (err) { res.status(500).json({ "message": "system error" }); }
				//console.log(delete_user);
				if (!delete_user) {
					res.status(400).json({ "message": "bad request" });
				}
				else {
					res.status(200).json({ "message": "success" });
				}
			});

	}
});

api.post('/api/picture/upload', api_token_check, upload.single('file'), function (req, res, next) {

	const counters = db.collection("counters");
	const pictures = db.collection("pictures")

	if (!req.file) {
		res.json({ message: "error: no file uploaded" });
	}
	else {
		console.log(">>> Uploading File: " + req.file);
		console.log(">>> File name: "+ req.file.originalname)
		var description = random_sentence();
		var name = randomWords({ exactly: 2 });
		name = name.join(' ');

		var payload = {
			_id: uuidv4(),
			title: req.file.originalname,
			image_url: req.file.path,
			name: name,
			filename: req.file.filename,
			description: description,
			creator_id: req.user.user_profile._id,
			money_made: 0,
			likes: 0,
			created_date: new Date()
		}

		pictures.insertOne(payload, { forceServerObjectId: true }, function (err, photo) {
			if (err) { res.status(500).json(err); return; }
			if (photo !== null) {
				res.status(200).json(photo);
			}
		}); // photo insert
	} //else
});


// user related.
api.post('/api/user/login', function (req, res) {
	if ((!req.body.user) || (!req.body.pass)) {
		res.status(422).json({ "message": "missing username and or password parameters" });
	}
	else {
		api_authenticate(req.body.user, req.body.pass, req, res);
	}
})

api.post('/api/user/register', function (req, res) {
	if ((!req.body.user) || (!req.body.pass)) {
		res.status(422).json({ "message": "missing username and or password parameters" });
	} else if (req.body.pass.length <= 4) {
		res.status(422).json({ "message": "password length too short, minimum of 5 characters" })
	} else {
		api_register(req.body.user, req.body.pass, req, res);
	}
})

api.get('/api/user/info', api_token_check, function (req, res) {
	let jwt_user = req.user.user_profile;
	if (!jwt_user.hasOwnProperty('_id')) {
		res.status(422).json({ "message": "missing userid" })
	}
	else {
		db.collection('users').find({ _id: req.user.user_profile._id }).toArray(function (err, user) {
			if (err) { return err }
			if (user) {
				res.status(200).json(user);
			}
		})
	}
});

api.put('/api/user/edit_info', api_token_check, function (req, res) {
	//console.log('in user put ' + req.user.user_profile._id);

	var objForUpdate = {};
	const users = db.collection('users');
	///console.log('BODY ' + JSON.stringify(req.body));
	if (req.body.email) { objForUpdate.email = req.body.email; }
	if (req.body.password) { objForUpdate.password = req.body.password; }
	if (req.body.name) { objForUpdate.name = req.body.name; }

	// Major issue here (API 6) - anyone can make themselves an admin!
	if (req.body.hasOwnProperty('is_admin')) {
		let is_admin_status = Boolean(req.body.is_admin);
		objForUpdate.is_admin = is_admin_status 
	}
	if (!req.body.email && !req.body.password && !req.body.name && !req.body.is_admin) {
		res.status(422).json({ "message": "no data to update, add it to body" });
	}
	else {
		var setObj = { objForUpdate }
		console.log(JSON.stringify(setObj));
		console.log(JSON.stringify(setObj));
		console.log(JSON.stringify(setObj));
		console.log(JSON.stringify(setObj));
		// deepcode ignore NoSqli: test
 		 users.findOneAndUpdate(
			{ _id: req.user.user_profile._id }, 
			{ $set: objForUpdate }, 
			{ returnNewDocument: true, upsert: true },
			function (err, userupdate) {
				if (err) { return err }
				if (userupdate) {
					console.log(userupdate);
					res.status(200).json({ "message": "User Successfully Updated" });
				}
			})
	}
});

api.get('/api/user/pictures', api_token_check, function (req, res) {
	db.collection('pictures').find({ creator_id: req.user.user._id }).toArray(function (err, pictures) {
		if (err) { return err };

		if (pictures) {
			console.log(pictures);
			res.json(pictures);

		}
	})
});


api.get('/api/user/likes', api_token_check, function (req, res) {
	console.log('like id ' + req.user._id);
	db.collection('likes').find({ user_id: req.user.user._id }).toArray(function (err, likes) {
		if (err) { return err };

		if (likes) {
			console.log(likes);
			res.json(likes);

		}
	})
});

api.get('/api/user/loves', api_token_check, function (req, res) {
	console.log('love id ' + req.user.user._id);
	mongo.connect(dbname, function (err, db) {
		db.collection('loves').find({ user_id: req.user.user._id }).toArray(function (err, loves) {
			if (err) { return err };

			if (loves) {
				console.log(loves);
				res.json(loves);

			}
		})
	})
});


api.get('/api/admin/all_users', api_token_check, function (req, res) {
	//res.json(req.user);
	//Authorization issue: can be called by non-admins.
	db.collection('users').find().toArray(function (err, all_users) {
		if (err) { return err }
		if (all_users) {
			res.json(all_users);
		}
	})
});

//API ROUTES

api.post('/api/login', function (req, res) {
	api_authenticate(req.body.user, req.body.pass, req, res);
})

api.post('/api/register', function (req, res) {
	if (req.body.user && req.body.pass) {
		api_register(req.body.user, req.body.pass, req, res);
	}
	else {
		res.status(202).json("missing user or pass");
	}
})

