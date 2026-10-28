var path         = require('path');
var logger       = require('morgan');
var express      = require('express');
var router       = express.Router();
var bodyParser   = require('body-parser');
var createError  = require('http-errors');
var cookieParser = require('cookie-parser');
const config     = require('./config/local.env.json');
const indy       = require('indy-sdk');
const util       = require('./config/util');
const colors     = require('./config/colors');
const indyerr    = require('./config/indyerr.js');
const log        = console.log;
let loggedIn     = false;
let poolHandle   = null;
let endorserWallet = {};

var app = express();

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// these handle HTTP POST body information, turning it into JSON format
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// API Service
var mongoose = require('mongoose');
mongoose.connect(config.db.uri + '/' + config.db.name, config.db.options)
  .then( () => console.log('connection successful') )
  .catch( (err) => console.error(err) );
mongoose.set('useFindAndModify', false);
// Required models
// var ServiceSettings = require('./models/ServiceSettings');
var VybeWallet = require('./models/VybeWallet');

// create api routes
app.use('/api', router); // api root

app.get('/api', function (req, res) {
  res.json({message: "API root!"});
})

// API helper functions
/*function getServiceSettings( srvcName, res ) {
  ServiceSettings.find(
    {servicename: srvcName}, 
  function(err, settings) {
    if (err) {
      res.send(err);
    } else {
      res.json(settings);
      console.log(srvcName + ' settings recovered ' + JSON.stringify(settings));
    }
  })
}
*/

/**
 * Checks the DB to see if the wallet exists.
 * @param {*} req 
 * @param {*} res 
 */
async function walletExists(req, res) {
  const fName = "walletExists"
  let result = false;
  let [vybeCfg, wConfig, wCreds] = extractWalletInfoFromRequest(req);
  const filter = {config: wConfig}
  const wallets = await VybeWallet.find(filter);
  if ( wallets.length > 0 ) { 
    result = true; 
    res.json({message: "Wallet exists", value: 1});
  } else {
    res.json({messsge: "Wallet does not exist", value: 0});
  }
  return result;
}

async function getUserWalletList(req, res) {
  const fName = "[getUserWalletList]"
  log(fName)
  let query = VybeWallet.where({ vybemeta: { data_type: 'Vybe', wallet_type: 'Company' } })
  query.find(function (err, walletList) {
    if (err) res.json({message: err});
    if (walletList) {
      log('\t' + JSON.stringify(walletList))
      res.json({message: 'Wallets found', wallets: walletList})
    } else {
      log('\tNo wallets match the description')
      res.json({message: '\tNo wallets match the description'})
    }
  });
}

/**
 * 
 * @param {*} vybeCfg 
 * @param {*} res 
 * @param {*} handle 
 * @param {*} wConfig 
 * @param {*} wCreds 
 * @param {*} dids 
 * @param {*} verKeys 
 */
async function upsertWallet( vybeCfg, res, handle, wConfig, wCreds, dids, verKeys ) {
  const filter = { config: wConfig };
  const update = { config: wConfig, handle: handle, credentials: wCreds, vybemeta: vybeCfg, dids: dids, verkeys: verKeys }

  /*
  */
  await VybeWallet.findOneAndUpdate( filter, update, {
    new: true, 
    upsert: true,
    rawResult: true,
    function(err, walletData) {
      if (err) {
        console.log('There is an issue --> ' + err);
        ((res != null) ? res.json({message: 'There is an issue --> ' + err}) : console.log('no res') )
      } else {
        console.log('Wallet Info Saved for wallet --> ' + JSON.stringify(update));
        ((res != null) ? res.json({message: 'Wallet Info Saved for wallet --> ' + JSON.stringify(update)}) : console.log('No res') )
      }
    }
  });
}

/**
 * 
 * @param {*} srvcName 
 * @param {*} req 
 * @param {*} res 
 */
function updateServiceSettings(srvcName, req, res) {
  ServiceSettings.find(
    {servicename: srvcName},
    function(err, settings) {
      let newData = req.body
      console.log(settings[0]);
      if ( settings.length > 0 ) {
        let oldData            = settings[0];
        let theInfo            = new ServiceSettings();
        theInfo.servicename    = oldData.servicename;
        theInfo.configsettings = oldData.configsettings;
        theInfo._id            = oldData._id;
        Object.keys(req.body).forEach(function(key) {
          console.log( "[" + key + "] => " + req.body[key]);
          theInfo.configsettings.set( key, req.body[key]);
        });
        ServiceSettings.updateOne(
          {servicename: srvcName},
          {$set: theInfo},
          {upsert: true},
          function(err) {
            if (err) {
              res.send(err);
              res.json({ message: 'There is an issue' + err });
            } else {
              res.json({ message: 'Config settings updated. Check MongoExpress!'});
            }
          });
      }
    }
  )
}

/**
 * This function should only be called once we are sure the wallet exists.
 * @param {*} req 
 * @param {*} res 
 */
async function openIndyWallet(req, res) {
  console.log("[openIndyWallet] Inside of the function");
  let [vybeCfg, config, creds] = extractWalletInfoFromRequest(req);
  const walletHandle = await indy.openWallet(config, creds)
  // The wallet hanlde should hook to the DB and update the wallets record
  //upsertWallet(vybeCfg, config, creds, handle);
  console.log("[openIndyWallet] Exiting the function");
  res.json({message:"Wallet opened"});
}

/**
 * This function closes a wallet. nd should not be called unless said wallet exists.
 * @param {*} req - should contain the config with wallet name and credentials with password
 * @param {*} res 
 */
async function closeIndyWallet(req, res) {
  console.log("[closeIndyWallet] Begin");
  // This should also test for the wallet in MongoDB
  if ( req.body["handle"] != null ) {
    // Pull data from request
    let handle = parseInt(req.body["handle"])
    await indy.closeWallet(handle);
    res.json({message: 'Wallet with handle ' + handle + ' closed.'});
  } else {
    res.json({message: "Wallet not closed"});
  }
  console.log("[closeIndyWallet] End");
}

async function loginToIndyWallet(req, res) {
  const fName = "[loginToIndyWallet]"
  log(fName)
  let [vybeCfg, config, creds] = extractWalletInfoFromRequest(req);
  log('\t' + JSON.stringify(endorserWallet))
  if ( endorserWallet.config.id == config.id && endorserWallet.credentials.key == creds.key ) {
    res.json({message: 'Wallet manager logged in', value: endorserWallet.handle})
    loggedIn = true
  } else {
    res.json({message: 'Login not allowed', value: 0})
  }
}

async function createIndyWallet(req, res) {
  const fName = "[createIndyWallet]";
  log(fName);
  if ( loggedIn ) {
    let [vybeCfg, config, creds] = extractWalletInfoFromRequest(req);
    vybeCfg["wallet_type"] = 'Company';
    await indy.createWallet(config, creds).then(handleIndyCreateWallet).catch(handleIndyError)
    const walletHandle = await indy.openWallet(config, creds)
    log('\twallet created with handle ' + walletHandle);
    const [userDid, userVerkey] = await indy.createAndStoreMyDid(walletHandle, "{}")
    let dids = {'basic': userDid} 
    let verKeys = {'basic': userVerkey}
    log('\t' + JSON.stringify(dids) +  '\n\t' + JSON.stringify(verKeys))
    let endorserDid = endorserWallet.dids['steward']
    log('\tEndorser Did -> ' + endorserDid)
    let nymReq = await indy.buildNymRequest(endorserDid, userDid, userVerkey, undefined, null)
    log('\tGot past nym request ' + JSON.stringify(nymReq))
    // indy.signAndSubmitRequest(pool_handle, wallet_handle, submitter_did, request_json)
    let reqRes = await indy.signAndSubmitRequest(poolHandle, endorserWallet.handle, endorserDid, nymReq).catch(handleIndyError)
    //upsertWallet( vybeCfg, res, handle, wConfig, wCreds, dids, verKeys ) {
    upsertWallet( vybeCfg, res, walletHandle, config, creds, dids, verKeys);
    res.json({message: 'Is there a requestResponse? ' + JSON.stringify(reqRes)});
  } else {
    log('\tPermission not granted, login value is ' + loggedIn)
    res.json({message: 'Permission not granted'})
  }

}

function extractWalletInfoFromRequest(req) {
  let vybeCfg = {};
  vybeCfg.data_type = "Vybe";
  let config = {};
  config.id = req.body["id"];
  let creds = {};
  creds.key = req.body["key"]
  return [vybeCfg, config, creds]
}

function listValues(val, ndx) {
  let res = ''
  if ( Array.isArray(val) ) {
    listValues(val, ndx)
  } else {
    console.log( '[listValues] ' + ndx + ' -> ' + val['pool'] );
    if ( ndx > 0 ) {
      res += '\n';
    }
    res += ndx + ' -> ' + val['pool']
  }
  return res
}

// Define functions for ledger pools
async function getPoolList(res) {
  var pools = await indy.listPools()
  //var poolList = pools.forEach(listValues);
  res.json(pools);
}

async function createInitialPool(req, res) {
  if (req.body['pass'] == 'Shabes') {
    await indy.setProtocolVersion(2);
    log('0. Set Indy protocol version to 2 to work with Indy Node 1.4');
    
    log('1. Creates a new local pool ledger configuration that is used later when connecting to ledger.')
    const poolName = 'pool'
    const genesisFilePath = await util.getPoolGenesisTxnPath(poolName)
    const poolConfig = {'genesis_txn': genesisFilePath}
    await indy.createPoolLedgerConfig(poolName, poolConfig).then(handleIndyCreatePLC).catch(handleIndyError)
    res.json({message: 'Pool created with name: <' + poolName + '>'});
  } else {
    res.json({message: 'You have no authority here'});
  }
}

/* ----------------------------------------------------------------------------
   API Wallet Endpoints
 ---------------------------------------------------------------------------- */

app.post( '/api/wallet/Exists', function(req, res) {
  walletExists(req, res);
}) 

app.post( '/api/wallet/Create', function(req, res) {
  createIndyWallet(req, res);
})

app.post( '/api/wallet/Login', function(req, res) {
  loginToIndyWallet(req, res);
})

app.post( '/api/wallet/Close', function(req, res) {
  closeIndyWallet(req,res);
})

app.get( '/api/wallet/GetUserWalletList', function(req, res) {
  getUserWalletList(req,res);
}) 

// API Pool Endpoints
app.get('/api/pool/List', function(req, res) {
  // Pools don't need to be in an external database.
  // The pools can be listed at any time.
  getPoolList(res);
});

app.post('/api/pool/CreateInitial', function(req, res) {
  createInitialPool(req, res);
});


/*
// API Inserts
app.post( '/api/config/BiometricService', function(req, res) {
  insertServiceSettings('BiometricService', req, res);
});
app.post( '/api/config/EnrollmentService', function(req, res) {
  insertServiceSettings('EnrollmentService', req, res);
});

// API Updates
app.put('/api/config/EnrollmentService', function(req, res) {
  updateServiceSettings('EnrollmentService', req, res);
});
app.put('/api/config/BiometricService', function(req, res) {
  updateServiceSettings('BiometricService', req, res);
});
*/

/**
 * The code here needs to come after the HTTP endpoint code
 * otherwise it will not work. It's my assuption this is due
 * to the path manipulation that occurs.
 */
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

try {
  setupStewardEndorser()
} catch(e) {
  log("ERROR occured: " + e)
}

module.exports = app;

function logValue() {
  log(colors.CYAN, ...arguments, colors.NONE)
}

function handleIndyError(err) {
  log('[handleIndyError]')
  let msg = ""
  if ( err.indyCode == indyerr.PoolLedgerConfigAlreadyExistsError ) {
    log("    a. [Jive sucka] The pool ledger configuration already exists, moving on.");
  } else if ( err.indyCode == indyerr.WalletAlreadyExistsError ) {
    msg = "    a. [Jive sucka] The wallet already exists, moving on." 
    log('\t' + msg);
    //res.json({message: msg});
  } else if ( err.indyCode == indyerr.PoolLedgerNotCreatedError ) {
    log("\ta. [Turkey snip] The code could not create the pool ledger.")
  } else if ( err.message == indyerr.WalletItemNotFound ) {
    log('\tIn the elseif ' + JSON.stringify(err))
  } else {
    log('\t' + JSON.stringify(err))
    //log('\t[' + err.indyName + '-' + err.indyCode +  '] ==> ' + err.indyMessage);
  }
}

function handleIndySetPV(resp) {
  log( "Protocol version set --> " + resp);
  return new Promise(function(resolve, reject) {
    if ( resp == null ) {
      reject(new Error("not good"))
    } else {
      resolve(resp);
    }
  });
}

function handleIndyCreatePLC(resp) {
  log('\t a. Created Pool Ledger Config');
}

function handleIndyCreateWallet() {
  log('\t a. Wallet created')
  //resp.json({message: 'Wallet Can be Created'});
}

async function setupStewardEndorser() {
  // Init
  await indy.setProtocolVersion(2);
  log('0. Set Indy protocol version to 2 to work with Indy Node 1.4');
 
  // 1. 
  log('1. Creates a new local pool ledger configuration that is used later when connecting to ledger.')
  const poolName = 'pool';
  const genesisFilePath = await util.getPoolGenesisTxnPath(poolName)
  const poolConfig = {'genesis_txn': genesisFilePath}
  await indy.createPoolLedgerConfig(poolName, poolConfig).then(handleIndyCreatePLC).catch(handleIndyError)
  log('\ta. Pool ledger config has been created.');

  // 2.
  log('2. Open pool ledger and get handle from libindy')
  poolHandle = await indy.openPoolLedger(poolName, undefined)
  log('  2.1 Pool handle is ' + poolHandle)

  // 3.
  log('3. Creating new secure wallet')
  const walletName = {"id": "kweli-wallet"}
  const walletCredentials = {"key": "keytruth"}
  await indy.createWallet(walletName, walletCredentials).then(handleIndyCreateWallet).catch(handleIndyError)

  // 4.
  log('4. Open wallet and get handle from libindy')
  const walletHandle = await indy.openWallet(walletName, walletCredentials)

  // 4.1 save info to database
  let vybeCfg = {}
  vybeCfg.data_type = "Vybranium Wallet Kweli version 0.1";
  upsertWallet(vybeCfg, null, walletHandle, walletName, walletCredentials, null, null)

  // 5.
  log('5. Generating and storing steward DID and verkey')
  const stewardSeed = '000000000000000000000000Steward1'
  const did = {'seed': stewardSeed}
  const [stewardDid, stewardVerkey] = await indy.createAndStoreMyDid(walletHandle, did)
  logValue('Steward DID: ', stewardDid)
  logValue('Steward Verkey: ', stewardVerkey)
  let dids = {'steward': stewardDid}
  let verKeys = {'steward': stewardVerkey}
  upsertWallet(vybeCfg, null, walletHandle, walletName, walletCredentials, dids, verKeys)

  // Now, create a new DID and verkey for a trust anchor, and store it in our wallet as well. Don't use a seed;
  // this DID and its keys are secure and random. Again, we're not writing to the ledger yet.

  // 6.
  log('6. Generating and storing trust anchor DID and verkey')
  const [trustAnchorDid, trustAnchorVerkey] = await indy.createAndStoreMyDid(walletHandle, "{}")
  logValue('Trust anchor DID: ', trustAnchorDid)
  logValue('Trust anchor Verkey: ', trustAnchorVerkey)
  dids['Endorser'] = trustAnchorDid
  verKeys['Endorser'] = trustAnchorVerkey
  upsertWallet(vybeCfg, null, walletHandle, walletName, walletCredentials, dids, verKeys)

  // Step 4 code goes here.
  // 7.
  log('7. Building NYM request to add Trust Anchor to the ledger')
  //indy.buildNymRequest( submitter_did, target_did, ver_key, alias, role 'TRUST_ANCHOR')
  const nymRequest = await indy.buildNymRequest(stewardDid, trustAnchorDid, trustAnchorVerkey, undefined, 'TRUST_ANCHOR')
  // 8.
  log('8. Sending NYM request to the ledger')
  // indy.signAndSubmitRequest(pool_handle, wallet_handle, submitter_did, request_json)
  await indy.signAndSubmitRequest(poolHandle, walletHandle, stewardDid, nymRequest)
  /*
  */
  endorserWallet = { 
    config: walletName, 
    handle: walletHandle, 
    credentials: walletCredentials, 
    vybemeta: vybeCfg, 
    dids: dids, 
    verkeys: verKeys
  }
}

async function run() {
  // Step 5 code goes here.
  // Here we are creating a third DID. This one is never written to the ledger, but we do have to have it in the
  // wallet, because every request to the ledger has to be signed by some requester. By creating a DID here, we
  // are forcing the wallet to allocate a keypair and identity that we can use to sign the request that's going
  // to read the trust anchor's info from the ledger.

  // 9.
  log('9. Generating and storing DID and verkey representing a Client that wants to obtain Trust Anchor Verkey')
  const [clientDid, clientVerkey] = await indy.createAndStoreMyDid(walletHandle, "{}")
  logValue('Client DID: ', clientDid)
  logValue('Client Verkey: ', clientVerkey)

  // 10.
  log('10. Building the GET_NYM request to query trust anchor verkey')
  const getNymRequest = await indy.buildGetNymRequest(/*submitter_did*/ clientDid,
      /*target_did*/ trustAnchorDid)

  // 11.
  log('11. Sending the Get NYM request to the ledger')
  const getNymResponse = await indy.submitRequest(/*pool_handle*/ poolHandle,
      /*request_json*/ getNymRequest)

  // See whether we received the same info that we wrote the ledger in step 4.

  // 12.
  log('12. Comparing Trust Anchor verkey as written by Steward and as retrieved in GET_NYM response submitted by Client')
  logValue('Written by Steward: ', trustAnchorVerkey)
  const verkeyFromLedger = JSON.parse(getNymResponse['result']['data'])['verkey']
  logValue('Queried from ledger: ', verkeyFromLedger)
  logValue('Matching: ', verkeyFromLedger == trustAnchorVerkey)

  // Do some cleanup.

  // 13.
  log('13. Closing wallet and pool')
  await indy.closeWallet(walletHandle)
  await indy.closePoolLedger(poolHandle)

  // 14.
  log('14. Deleting created wallet')
  await indy.deleteWallet(walletName, walletCredentials)

  // 15.
  log('15. Deleting pool ledger config')
  await indy.deletePoolLedgerConfig(poolName)
}
