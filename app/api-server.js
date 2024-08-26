'use strict';

const express = require('express');
const serveStatic = require('serve-static');
const bodyParser = require('body-parser')

const randomWords = require('random-words');
const Sentencer = require('sentencer');
const https = require('https');
const fs = require('fs');

//database
const MongoClient = require('mongodb').MongoClient;
const dotenv = require('dotenv');

//auth/token stuff
var jwt = require('jsonwebtoken');

// Crypto to generate UUIDs
const { v4: uuidv4 } = require('uuid');
const { create } = require('domain');
const { type } = require('os');
const { exit } = require('process');

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

//accept files in /uploads dir (pictures)
api.use(serveStatic(__dirname + '/uploads'));

//API binds to interface pixiapp:8090
api.listen(8090, function () {
	if (process.env.NODE_ENV === undefined)
		process.env.NODE_ENV = 'development';
	console.log("PixiApp: API running on port %d in %s mode.", this.address().port, process.env.NODE_ENV);
});

// Connect to MongoDB
dotenv.config();
const mongo_url = process.env.MONGO_URL;
console.log('API Server starting - Will connect to Mongo on: ' + mongo_url);

// Mongo V3+ Driver separates url from dbname / uses client
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
			console.log('>>> Query error...' + err);
			res.status(500).json({ "message": "system error" });
		}
		if (result !== null) {
			// API10: This is bad logging, as it dumps the full user record
			console.log('>>> Found User:  ' + result);
			var user_profile = result;
			// API7/API3: Add full record to JWT token (including clear password)
			var payload = { user_profile };
			var token = create_jwt ('RS384', 'pixiUsers', 'https://issuer.42crunch.demo', user_profile.email, payload, privateKey);
			res.status(200).json({ message: "success", token: token, _id: user_profile._id });
		}
		else
			res.status(401).json({ message: "sorry dear, invalid login" });
	});
}

function api_register(user, pass, req, res) {
	console.log('>>> Registering user: ' + user + ' with password: ' + pass);
	const users = db.collection('users');
	// Check if user exists first
	users.findOne({ email: user }, function (err, result) {
		if (err) {
			console.log('>>> Query error...' + err);
			res.status(500).json({ "message": "system error" });
		}
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
				onboarding_date: new Date()
			};
			// forceServerObjectId forces Mongo to use the specified _id instead of generating a random one.
			users.insertOne(payload, { forceServerObjectId: true }, function (err, user) {
				if (err) {
					console.log('>>> Query error...' + err);
					res.status(500).json({ "message": "system error" });
				}
				if (user.insertedId != null) {
					var user_profile = payload;
					var jwt_payload = { user_profile };
					try {
						var token = create_jwt ('RS384', 'pixiUsers', 'https://issuer.42crunch.demo', subject, jwt_payload, privateKey);
						res.status(200).json({ message: "success", token: token, _id: payload._id });
					}
					catch {
						console.log(">>> Error occurred during JWT creation");
						res.status(400).json({ message: "registration failure", token: null, _id: null });
					}
				} //if user
			}) //insert
		} // else
	});
}

function create_jwt (algorithm, audience, issuer, subject, jwt_payload, key) {
	var token = "";
	try {
		token = jwt.sign(jwt_payload, key, {
			algorithm: algorithm,
			issuer: issuer,
			subject: subject,
			expiresIn: "4w",
			audience: audience
		})
		return token	
	}
	catch (e) {
		// Re-throw original issue.
		throw e
	}
}

function api_token_check(req, res, next) {

	console.log('>>> Validating token: ' + JSON.stringify(req.headers['x-access-token']));
	var token = req.headers['x-access-token'];

	// decode jwt token
	if (token) {
		// Verify token
		jwt.verify(token, publicKey, function (err, user) {
			if (err) {
				console.log(err)
				return res.status(403).json({ success: false, message: 'Failed to authenticate token' });
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
		"The {{ nouns }} {{ adjective }} is back",
		"Breakfast, {{ an_adjective }}, {{ adjective }} for {{ noun }}",
		"Oldie but goodie {{ a_noun }} and {{ a_noun }} {{ adjective }} {{ noun }}",
		"My {{ noun }} is {{ an_adjective }} which is better than yours",
		"That time when your {{ noun }} feels {{ adjective }} and {{ noun }}"
	];

	var my_sentence = samples[Math.floor(Math.random() * (4 - 1)) + 1];
	var sentencer = Sentencer.make(my_sentence);
	return sentencer;
}

api.delete('/api/picture/:id', api_token_check, function (req, res) {
	console.log('>>> Deleting picture ' + req.params.id);
	const pictures = db.collection('pictures');
	// BOLA - API1 Issue here: a user can delete someone's else picture.
	// Code does not validate who the picture belongs too.
	pictures.deleteOne({ _id: req.params.id },
		function (err, result) {
			if (err) {
				console.log('>>> Query error...' + err);
				res.status(500).json({ "message": "system error" });
			}
			if (result.deletedCount == 0) {
				console.log(">>> No picture was deleted")
				res.status(404).json({ "message": "not found" });
			}
			else {
				console.log('>>> Photo ' + req.params.id + ' was deleted');
				res.status(200).json({ "message": "success" });
			}
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
			function (err, result) {
				if (err) {
					console.log('>>> Query error...' + err);
					res.status(500).json({ "message": "system error" });
				}
				//console.log("result object:" + result.deletedCount);
				if (result.deletedCount == 0) {
					console.log(">>> No user was deleted")
					res.status(400).json({ "message": "bad input" });
				}
				else {
					res.status(200).json({ "message": "success" });
				}
			});

	}
});

api.post('/api/picture/file_upload', api_token_check, function (req, res) {
	const pictures = db.collection("pictures")

	if (!req.body.filename) {
		res.status(400).json({ "message": "missing filename" });
		return;
	}

	if (!req.body.filename.startsWith ("https")) {
		res.status(400).json({ "message": "incorrect URL" });
	} 
	else {
		//console.log(">>> Uploading File: " + req.body.contents);
		const imageUUID = uuidv4();
		const imageName = imageUUID + ".img";
		const imageUrl = __dirname + '/uploads/' + imageName;
		
		try {
			https.get(req.body.filename, (response) => {
			// Create a write stream to save the file locally
			const fileStream = fs.createWriteStream(imageUrl);
		  
			// When data is received, write it to the file stream
			response.on('data', (chunk) => {
			  fileStream.write(chunk);
			});
		  
			// When the response ends, close the file stream
			response.on('end', () => {
			  fileStream.end();
			  console.log('File downloaded and saved successfully.');
			});
		  }).on('error', (err) => {
			console.error('Error downloading the file:', err.message);
		  });
		  
		}
		catch (e) {
			console.log ("Exception raised while/saving retrieving file: " + e.message );
			res.status(400).json({ "message": "bad data input" });
			return;
		}
		
		var description = random_sentence();
		var name = randomWords({ exactly: 2 });
		name = name.join(' ');

		var payload = {
			_id: imageUUID,
			title: req.body.title,
			image_url: imageUrl,
			name: name,
			filename: imageName,
			description: description,
			creator_id: req.user.user_profile._id,
			money_made: 0,
			likes: 0,
			created_date: new Date(),
			filename_url: req.body.filename
		}

		pictures.insertOne(payload, { forceServerObjectId: true }, function (err, result) {
			if (err) {
				console.log('>>> Query error...' + err);
				res.status(500).json({ "message": "system error" });
			}
			console.log("Inserted ID: " + result.insertedId)
			if (result.insertedId !== null) {
				res.status(200).json({ "message": "success", "_id": result.insertedId });
			}
		}); // photo insert
	} //else
});

api.post('/api/picture/upload', api_token_check, function (req, res) {
	const pictures = db.collection("pictures")

	if (!req.body.contents) {
		res.status(400).json({ "message": "missing file" });
	}
	else {
		//console.log(">>> Uploading File: " + req.body.contents);
		const imageUUID = uuidv4();
		const imageName = imageUUID + ".img";
		const imageUrl = __dirname + '/uploads/' + imageName;
		console.log(">>> Uploading File: " + imageUrl);
		try {
			const imageBuffer = Buffer.from(req.body.contents, 'base64');
			fs.writeFileSync(imageUrl, imageBuffer);
		}
		catch (exc) {
			console.log ("Exception raised while saving file: " + e );
			res.status(400).json({ "message": "bad data input" });
			return;
		}

		var description = random_sentence();
		var name = randomWords({ exactly: 2 });
		name = name.join(' ');

		var payload = {
			_id: imageUUID,
			title: req.body.title,
			image_url: imageUrl,
			name: name,
			filename: imageName,
			description: description,
			creator_id: req.user.user_profile._id,
			money_made: 0,
			likes: 0,
			created_date: new Date()
		}

		pictures.insertOne(payload, { forceServerObjectId: true }, function (err, result) {
			if (err) {
				console.log('>>> Query error...' + err);
				res.status(500).json({ "message": "system error" });
			}
			console.log("Inserted ID: " + result.insertedId)
			if (result.insertedId !== null) {
				res.status(200).json({ "message": "success", "_id": result.insertedId });
			}
		}); // photo insert
	} //else
});

api.post('/api/admin/user/tokens', function (req, res) {
	if ((!req.body.type)) {
		res.status(422).json({ "message": "missing token type" });
	}
	else {
		const payload = {
			"_id": "41dda03a-518f-4fd5-9d5f-c78da496c3e2",
			"email": "user-inbound@acme.com",
			"password": "hellopixi",
			"name": "Santiago Wilderman",
			"account_balance": 1000,
			"is_admin": false,
			"onboarding_date": "2023-07-10T20:19:52.165Z"
		}
		var user_profile = payload;
		var jwt_payload = { user_profile };
		var token_type = req.body.type ;
		var token = "";
		switch (token_type) {
			case 'bad_algo':
				console.log('Selected: Generating JWT with Bad Algo');
				var symmetricKey = "owasptopsecretowasptopsecret";
				token = create_jwt ('HS256', 'pixiUsers', 'https://issuer.42crunch.demo', payload.email, jwt_payload, symmetricKey);
				res.status(200).json({ message: "success", token: token});
				break;
			case 'bad_issuer':
				console.log('Selected: Generating JWT with Bad Issuer');
				token = create_jwt ('RS384', 'pixiUsers', 'https://wrongissuer.test', payload.email, jwt_payload, privateKey);
				res.status(200).json({ message: "success", token: token});
				break;
			case 'bad_audience':
				console.log('Selected: Generating JWT with Bad Audience');		
				token = create_jwt ('RS384', 'badActors', 'https://issuer.42crunch.demo', payload.email, jwt_payload, privateKey);
				res.status(200).json({ message: "success", token: token});
				break;
			default:
				res.status(400).json({ message: "Bad Input"});
		  }
	}
})

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

api.get('/api/user/info/:id', api_token_check, function (req, res) {
	console.log('>>> Fetching users ' + req.params.id);
	const users = db.collection('users');
	// BOLA - API1 Issue here: a user can get someone's information.
	// Code does not validate who the user making the request is.
	users.findOne({ _id: req.params.id },
		function (err, result) {
			if (err) {
				console.log('>>> Query error...' + err);
				res.status(500).json({ "message": "system error" });
			}
			if (!result) {
				console.log(">>> No user was found")
				res.status(404).json({ "message": "not found" });
			}
			else {
				console.log('>>> User info for ' + req.params.id + ' was returned');
				// API3 - Sensitive data exposure: the user's password is returned in the response.
				// Filter the properties in response
				res.status(200).json({"_id": result._id, "email": result.email, "name": result.name, "account_balance": result.account_balance, "is_admin": result.is_admin});
		}
	})
});

api.put('/api/user/edit_info', api_token_check, function (req, res) {
	//console.log('in user put ' + req.user.user_profile._id);

	var objForUpdate = {};
	const users = db.collection('users');
	///console.log('BODY ' + JSON.stringify(req.body));
	if (req.body.email) { objForUpdate.email = req.body.email; }
	if (req.body.password) { objForUpdate.password = req.body.password; }
	if (req.body.name) { objForUpdate.name = req.body.name; }
	if (req.body.account_balance) { objForUpdate.account_balance = req.body.account_balance; }

	// Major issue here (API 6) - anyone can make themselves an admin!
	if (req.body.hasOwnProperty('is_admin')) {
		let is_admin_status = Boolean(req.body.is_admin);
		objForUpdate.is_admin = is_admin_status
	}
	if (!req.body.email && !req.body.password && !req.body.name && !req.body.is_admin && !req.body.account_balance) {
		res.status(422).json({ "message": "Bad input" });
	}
	else {
		var setObj = { objForUpdate }
		console.log(">>> Update User Data: " + JSON.stringify(setObj));
		users.findOneAndUpdate(
			{ _id: req.user.user_profile._id },
			{ $set: objForUpdate },
			{ returnNewDocument: true, upsert: true },
			function (err, userupdate) {
				if (err) {
					console.log('>>> Query error...' + err);
					res.status(500).json({ "message": "system error" });
				}
				if (userupdate) {
					console.log(userupdate);
					res.status(200).json({ "message": "User Successfully Updated" });
				}
				else {
					res.status(400).json({ "message": "Bad Request" });
				}
			})
	}
});

api.get('/api/user/pictures', api_token_check, function (req, res) {

	const pictures = db.collection('pictures');

	pictures.find({ creator_id: req.user.user_profile._id }).toArray(function (err, pictures) {
		if (err) {
			console.log('>>> Query error...' + err);
			res.status(500).json({ "message": "system error" });
		}

		if (pictures) {
			console.log(">>> Pictures list: " + pictures);
			res.json(pictures);

		}
	})
});
	
api.get('/api/user/pictures/:id', api_token_check, function (req, res) {

	const pictures = db.collection('pictures');
	// BOLA - API1 Issue here: a user can get someone else's pictures.
	// Code does not validate who the requester is before returning the pictures.
	pictures.find({ creator_id: req.params.id }).toArray(function (err, pictures) {
		if (err) {
			console.log('>>> Query error...' + err);
			res.status(500).json({ "message": "system error" });
		}

		if (pictures) {
			console.log(">>> Pictures list: " + pictures);
			res.json(pictures);

		}
	})
});

api.get('/api/admin/all_users', api_token_check, function (req, res) {
	//res.json(req.user);
	//API2 - Authorization issue: can be called by non-admins.
	db.collection('users').find().toArray(function (err, all_users) {
		if (err) { return err }
		if (all_users) {
			res.json(all_users);
		}
	})
});

api.get('/api/healthz', function (req, res) {
	const specialHeader = req.headers['health-agent'];
	if ( specialHeader.startsWith ('k8s-platform') ) {
		res.status(200).json({ "message": "Alive and Well" });
	} else {
		res.status(400).json({ "message": "Not Welcome Here" });
	}
	
});
