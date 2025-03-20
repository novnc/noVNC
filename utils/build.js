#!/usr/bin/env node
import fs from "fs";
import path from "path";
import fse from "fs-extra";
import { program } from "commander";
import { ensureDir } from "fs-extra";
import { fileURLToPath } from "url";

program
    .option("--clean", "clear the lib folder before building")
    .parse(process.argv);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// the various important paths
const paths = {
    main: path.resolve(__dirname, ".."),
    core: path.resolve(__dirname, "..", "core"),
    vendor: path.resolve(__dirname, "..", "vendor"),
    libDirBase: path.resolve(__dirname, "..", "lib"),
};

// walkDir *recursively* walks directories trees,
// calling the callback for all normal files found.
const walkDir = async (basePath, cb, filter) => {
    const files = await fs.promises.readdir(basePath);
    const paths = files.map((filename) => path.join(basePath, filename));
    return Promise.all(
        paths.map(async (filepath) => {
            const stats = await fs.promises.lstat(filepath);
            if (filter !== undefined && !filter(filepath, stats)) return;
            if (stats.isSymbolicLink()) return;
            if (stats.isFile()) return cb(filepath);
            if (stats.isDirectory()) return walkDir(filepath, cb, filter);
        })
    );
};

const makeLibFiles = async () => {
    fse.ensureDirSync(paths.libDirBase);
    const outFiles = [];

    const handleDir = async (vendorRewrite, inPathBase, filename) => {
        const outPath = path.join(
            paths.libDirBase,
            path.relative(inPathBase, filename)
        );
        if (path.extname(filename) !== ".js") {
            return; // skip non-javascript files
        }
        await ensureDir(path.dirname(outPath));
        await fs.promises.copyFile(filename, outPath);
        console.log(`Writing ${outPath}`);
        outFiles.push(`${outPath}`);
    };
    const handler = handleDir.bind(null, false, paths.main);
    await walkDir(paths.vendor, handler);
    const handler2 = handleDir.bind(null, true, paths.core);
    await walkDir(paths.core, handler2);
    return outFiles;
};
const options = program.opts();
if (options.clean) {
    console.log(`Removing ${paths.libDirBase}`);
    fse.removeSync(paths.libDirBase);
}
makeLibFiles()
    .then((outFiles) => {
        console.log(`Converted ${outFiles.length} files`);
    })
    .catch((err) => {
        console.error(`Failure converting modules: ${err}`);
        process.exit(1);
    });
