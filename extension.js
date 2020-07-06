const vscode = require('vscode');
const exec = require('child_process').exec;
const fs = require('fs');
const path = require('path');

const ERROR = {
	PORT_FAILED: 'ampy.pyboard.PyboardError: failed to access /dev/ttyUSB0'
};

const BASE_DIR = vscode.workspace.workspaceFolders[0].uri
			.toString()
			.split(':')[1];
const CONFIG_PATH = path.join(BASE_DIR, '.vscode');


/* helper method to get terminal easly */
function getTerminal() {
	let terminal = vscode.window.activeTerminal;
	if (!terminal) {
		terminal = vscode.window.createTerminal();
		terminal.show();
	}
	return terminal;
}

function getInfo() {
	let command = 'import machine, binascii, sys \n' + 
				  'mac = binascii.hexlify(machine.unique_id()).decode("utf8").upper()\n' + 
				  'device = sys.platform\n' + 
				  'py_version = sys.version\n' + 
				  'mpy_version = ".".join(str(c) for c in sys.implementation[1])\n' + 
				  'freq = machine.freq()\n' + 
				  'print(mac, device, py_version, mpy_version, freq)\n'
	

	let tmp_file = path.join(BASE_DIR, '.tmp_py99');
	
	fs.writeFileSync(tmp_file, command);

	exec(ampy(`run ${tmp_file}`), (err, stdout, stderr) => {
		if (err) {
			vscode.window.showWarningMessage('Failed to connect to device' + 
											err.message.toString());
		} else {
			let sysInfo = stdout.split(' ');
			console.log(stdout.split(' '));
			let info = {
				mac: sysInfo[0],
				device: sysInfo[1],
				py_version: sysInfo[2],
				mpy_version: sysInfo[3],
				freq: sysInfo[4].trimRight(),
			}

			// create a device JSON file with the system information
			if (!fs.existsSync(CONFIG_PATH)) {
				fs.mkdirSync(CONFIG_PATH);
			}
			fs.writeFileSync(path.join(CONFIG_PATH, 'device.json'), 
							JSON.stringify(info, null, 4));
			// delete temp file
			fs.unlinkSync(tmp_file);
		}
	});

}

/* helper method for getting the project dir */
function getDir() {
	return vscode.workspace.getConfiguration("uhookpython").get('projectPath');
}

function ampy(command) {
	let conf = vscode.workspace.getConfiguration("uhookpython");
	let ampy = path.join(BASE_DIR, conf.get("ampyPath"));
	let port = conf.get('port');
	let baud = conf.get('baud');
	return `${ampy} -p ${port} -b ${baud} ${command}`;
}

function _ls(callback) {
	exec(ampy('ls'), (err, stdout, stderr) => {

		if (err) {
			callback(null);
		} else {
			let fileString = stdout.split('\n');
			let files = [];

			// need to trim off the starting '/' 
			// there's also an empty string in the stdout that we remove
			for (var i in fileString) {
				let file = fileString[i];
				if (file) {
					files.push(file.substring(1, file.length));
				}
			}
			callback(files);
		}
	});
}

/* helper functions for the real getAll. Gets all files from the
   device and saves them to chosen directory from config file */
function _getAll() {

	_ls((result) => {

		if (result) {

			// ensure that target directory exists before we begin
			let dir = getDir();
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, {recursive: true});
			}

			// set up some variables to build query command
			let totalFiles = result.length;
			let file, i;
			let command = '';
			let displayMsg = `Gettings ${totalFiles} files from device: (`
			
			// build the command, this way it runs synchronously
			for (i in result) {
				file = result[i];
				command += ampy(`get ${file} > ${path.join(dir, file)} && `);
				displayMsg += `${file}, `;
			}
			// chop of the last '&&'
			command = command.substring(0, command.length - 3);

			vscode.window.showInformationMessage(displayMsg.
							substring(0, displayMsg.length - 2) + ' )');
			

			// execute the command
			exec(command, (err, stdout, stderr) => {
				if (err) {
					vscode.window.showErrorMessage(err.message.toString());
				} else {
					console.log(parseInt(i) + 1 );
					vscode.window.showInformationMessage(`${totalFiles} files retrieved from device, ` + 
														`saved in ${dir}`);
				}
			});

		} else {
			vscode.window.showErrorMessage('Failed to read files from device. Check ' + 
											'permissions and that the right path to ' + 
											'ampy is set in the settings.json ' + 
											'Run uhookpython: Setup Configurations ' + 
											'to setup a new file');
		}

	});

}

function test() {
	getInfo();
}

function activate(context) {

	let debug = vscode.commands.registerCommand('uhookpython.debug', () => {
		test();
	});

	let upload = vscode.commands.registerCommand('uhookpython.upload', () => {
		
		let dir = getDir();

		if (!fs.existsSync(dir)) {
			vscode.window.showErrorMessage(`Can't find directory ${dir}. Please check` + 
											`that the path exists and is correct in the` + 
											`settings.json file. Use uhookpython: Setup` + 
											`configurations to create one.`);
			return;
		}

		let sourceFiles = fs.readdirSync(dir);
		let displayMsg = `Transferring ${sourceFiles.length} files to device: ( `
		
		// build the query command
		let file, i;
		let command = '';
		for (i in sourceFiles) {
			file = sourceFiles[i];
			command += ampy(`put ${file} && `);
			displayMsg += `${file}, `
		}
		command = command.substring(0, command.length - 2);
		vscode.window.showInformationMessage(displayMsg.
									substring(0, displayMsg.length - 2) + ' )');

		exec(command, (err, stdout, stderr) => {
			if (err) {
				vscode.window.showErrorMessage(`An error occured when transfering files` + 
												`${err.message.toString()}`);
			} else {
				vscode.window.showInformationMessage(`Success, ${sourceFiles.length} files to sent device`);
			}
		});


	});

	let getAll = vscode.commands.registerCommand('uhookpython.getAll', () => {
		_getAll();
	});

	let runFile = vscode.commands.registerCommand('uhookpython.runFile', () => {
		
		let terminal = getTerminal();
		let currentFile = vscode.window.activeTextEditor.document.uri.fsPath;
		
		terminal.sendText(ampy(`run ${currentFile}`));
	});
	
	let ls = vscode.commands.registerCommand('uhookpython.ls', () => {
		let terminal = getTerminal();
		terminal.sendText(ampy('ls'));

	});

	let getFile = vscode.commands.registerCommand('uhookpython.getFile', () => {

		vscode.window.showInputBox({prompt: "Enter the file you want to get "})
		.then((input) => {
			let file = input;

			_ls( (result) => {
				if (result.includes(ERROR.PORT_FAILED)) {
					let port = vscode.workspace.getConfiguration("uhookpython").get('port');
					vscode.window.showErrorMessage(`Failed to access port ${port}`);
				} else {
					if (result.indexOf(file) >= 0) {
						let terminal = getTerminal();
						terminal.sendText(ampy(`get ${file} > ${file}`));
					} else {
						vscode.window.showErrorMessage(`Can't find ${file} on device`);
					}

				}
			});
			
		});

		

	});

	let setupConfig = vscode.commands.registerCommand('uhookpython.setupConfig', () => {

		let config = {
			'uhookpython.baud': 115200,
			'uhookpython.port': '/dev/ttyUSB0',
			"uhookpython.projectPath": BASE_DIR.substring(2, BASE_DIR.length),
			'uhookpython.ampyPath': ''
		};


		let filePath = path.join(CONFIG_PATH, 'settings.json');

		if (!fs.existsSync(CONFIG_PATH)) {
			fs.mkdirSync(CONFIG_PATH, {recursive: false});
		}

		fs.writeFileSync(filePath, JSON.stringify(config, null, 4), 'utf8');

		if (!fs.existsSync(CONFIG_PATH)) {
			vscode.window.showErrorMessage('Failed when creating setup file, check permissions?');
		} else {
			vscode.window.showInformationMessage(`Config file created at ${filePath}`);
		}
		
		

	});

	let reset = vscode.commands.registerCommand('uhookpython.reset', () => {
		exec(ampy('reset'), (err, stdout, stderr) => {
			if (err) {
				vscode.window.showErrorMessage('Failed to connect to device' + 
												+ err.message.toString());
			} else {
				vscode.window.showInformationMessage('Device reset');
			}
		});
	});

	let mkdir = vscode.commands.registerCommand('uhookpython.mkdir', () => {

		vscode.window.showInputBox({prompt: "Name of directory: "})
		.then((dir) => {
			exec(ampy(`mkdir ${dir}`), (err, stdout, stderr) => {
				if (err) {
					vscode.window.showErrorMessage('Failed to connect crreate dir: ' + 
													+ err.message.toString());
				} else {
					vscode.window.showInformationMessage(`${dir} created`);
				}
			});	
		});

	});

	let rmdir = vscode.commands.registerCommand('uhookpython.rmdir', () => {
		vscode.window.showInputBox({prompt: "Name of directory: "})
		.then((dir) => {
			exec(ampy(`rmdir ${dir}`), (err, stdout, stderr) => {
				if (err) {
					vscode.window.showErrorMessage('Failed to connect crreate dir: ' + 
													+ err.message.toString());
				} else {
					vscode.window.showInformationMessage(`${dir} removed`);
				}
			});	
		});
	});


	context.subscriptions.push(debug);
	context.subscriptions.push(runFile);
	context.subscriptions.push(getFile);
	context.subscriptions.push(upload);
	context.subscriptions.push(reset);
	context.subscriptions.push(mkdir);
	context.subscriptions.push(rmdir);
	context.subscriptions.push(getAll);
	context.subscriptions.push(ls);
	context.subscriptions.push(setupConfig);

}
exports.activate = activate;

function deactivate() {}

module.exports = {
	activate,
	deactivate
}

