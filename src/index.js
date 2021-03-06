import 'colors';

import path from 'path';
import fs from 'fs-extra';
import unit from 'unitex';
import nico from './nico';
import metagen from './metagen';
import { log, warn } from './logger';

import config from '../config';

let id = process.argv[2] || process.exit();

let datafmt = unit.formatter({ unit: 'B', base: 1024, atomic: true });
let ratefmt = unit.formatter({ unit: 'B/s', base: 1024, atomic: true });
let timefmt = unit.formatter({ unit: 's' });

let time = () => process.hrtime()[0];

void async () => {
	try {
		let dldir = path.join('.', config.dl, id);

		let [dirp, loginp] = [
			new Promise((res, rej) => {
				fs.mkdirp(dldir, err => {
					if (err) {
						return rej(err);
					}
					res();
				});
			}),
			nico.login({
				mail_tel: config.email,
				password: config.password
			})
		];

		log('Logging In');
		await loginp;
		let [metap, flvp] = [nico.meta(id), nico.flv(id)];

		log('Fetching Metadata');
		let meta = await metap;

		log('Writing Metafile');
		fs.writeFileSync(path.join(dldir, 'meta'), metagen({
			id: meta.video_id,
			uploader: meta.user_nickname,
			uploaderid: meta.user_id,
			title: meta.title,
			desc: meta.description
		}));

		log('Fetching Video URL');
		let { url } = await flvp;

		if (/low/.test(url)) {
			warn('Low Quality');
		}

		log('Requesting Video', url);
		await dirp;
		let down = await nico.r.get(url);
		await new Promise(resolve => {
			down.on('response', res => {
				let size = res.headers['content-length'];
				log('Downloading Video', datafmt(size));

				down.pipe(fs.createWriteStream(path.join(dldir, `${id}.mp4`)));

				let { stdout } = process,
					start = time(),
					processed = 0,
					buffered = 0;

				let logStatus = () => {
					processed += buffered;
					let line = `${ (processed / size * 100).toFixed(2) }%	`
						+ `${ datafmt(processed) }	`
						+ `${ ratefmt(buffered) }	`
						+ `${ timefmt(time() - start) }	`
						+ `ETA ${ timefmt((size - processed) * (time() - start) / processed) }`;
					buffered = 0;
					stdout.clearLine();
					stdout.cursorTo(0);
					stdout.write(line.cyan);
				};
				logStatus();
				let logger = setInterval(logStatus, 1000);

				down.on('data', data => {
					buffered += data.length;
				}).on('end', () => {
					logStatus();
					clearInterval(logger);
					console.log();
					resolve();
				});
			})
		});
		log('Finished');
	}
	catch (e) {
		warn(e);
	}
}();
