const { spawn } = require('child_process');
const platform = require('os').platform();

const defaultDir = __dirname + '/bin';
const bin = './ngrok' + (platform === 'win32' ? '.exe' : '');
const ready = /starting web service.*addr=(\d+\.\d+\.\d+\.\d+:\d+)/;
const inUse = /address already in use/;

let processPromise, activeProcess;

/*
	ngrok process runs internal ngrok api
	and should be spawned only ONCE 
	(respawn allowed if it fails or .kill method called)
*/

async function getProcess(opts) {
	console.log("Getting ngrok process")
	console.log(process.pid)
	if (processPromise) return processPromise; 
	try {
		processPromise = startProcess(opts);
		return await processPromise;
	}
	catch(ex) {
		processPromise = null;
		throw ex;
	}
}

async function startProcess (opts) {
	let dir = defaultDir;
	const start = ['start', '--none', '--log=stdout'];
	if (opts.region) start.push('--region=' + opts.region);
	if (opts.configPath) start.push('--config=' + opts.configPath);
	if (opts.binPath) dir = opts.binPath(dir);
	
	const ngrok = spawn(bin, start, {cwd: dir});
	
	let resolve, reject;
	const apiUrl = new Promise((res, rej) => {   
		resolve = res;
		reject = rej;
	});

	ngrok.stdout.on('data', data => {
		const msg = data.toString();
		const addr = msg.match(ready);
		if (addr) {
			resolve(`http://${addr[1]}`);
		} else if (msg.match(inUse)) {
			reject(new Error(msg.substring(0, 10000)));
		}
		console.log(`Ngrok: ${data.toString()}`)
	});  

	ngrok.stderr.on('data', data => {
		const msg = data.toString().substring(0, 10000);
		console.log("Ngrok stderr")
		console.log(msg)
		console.log(process.pid)
		reject(new Error(msg));
	});

	ngrok.on('exit', (code, signal) => {
  		console.log('ngrok process exited with ' +
              		`code ${code} and signal ${signal}`);		
		processPromise = null;
		activeProcess = null;
	});

	process.on('exit', async (code, signal) => {
  		console.log('root process exited with ' +
              		`code ${code} and signal ${signal}`);	
		await killProcess()
	});

	try {
		const url = await apiUrl;
		activeProcess = ngrok;
		return url;      
	}
	catch(ex) {
		ngrok.kill();
		throw ex;
	}
	finally {
		ngrok.stdout.removeAllListeners('data');
		ngrok.stderr.removeAllListeners('data');
	}
}

function killProcess ()  {
	console.log("Kill process called");
	if (!activeProcess) return;
	return new Promise(resolve => {
		activeProcess.on('exit', () => resolve());
		activeProcess.kill();
	});
}

/**
 * @param {string | INgrokOptions} optsOrToken
 */
async function setAuthtoken (optsOrToken) {
	const isOpts = typeof optsOrToken !== 'string'
	const opts = isOpts ? optsOrToken : {}
	const token = isOpts ? opts.authtoken : optsOrToken

	const authtoken = ['authtoken', token];
	if (opts.configPath) authtoken.push('--config=' + opts.configPath);

	let dir = defaultDir;
	if (opts.binPath) dir = opts.binPath(dir)
	const ngrok = spawn(bin, authtoken, {cwd: dir});

	const killed = new Promise((resolve, reject) => {
		ngrok.stdout.once('data', () => resolve());
		ngrok.stderr.once('data', () => reject(new Error('cant set authtoken')));
	});

	try {
		return await killed;
	}
	finally {
		ngrok.kill();
	}
}

module.exports = {
	getProcess,
	killProcess,
	setAuthtoken
};
