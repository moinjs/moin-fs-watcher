let fs = require("fs");
let path = require("path");
let chokidar = require('chokidar');


let readdir = (folder)=>new Promise((resolve, reject)=> {
    fs.readdir(folder, (err, files)=> {
        err ? reject(err) : resolve(files);
    });
});

let isFolder = (path)=>new Promise((resolve, reject)=> {
    fs.stat(path, (err, stats)=> {
        err ? reject(err) : resolve(stats.isDirectory());
    });
});

let getRealFolder = (folder)=> new Promise((resolve, reject)=> {
    fs.realpath(folder, function (err, realpath) {
        if (err) {
            reject("cannot get real path of service");
        } else {
            resolve(realpath);
        }
    });
})

const LOADED = Symbol("LOADED");
const INVALID = Symbol("INVALID");

module.exports = function (moin, settings) {

    let idMap = new Map();

    moin.on("unloadService", (id)=> {
        if (idMap.has(id))idMap.delete(id);
    });

    function loadFolder(folder) {
        let loaded = {};
        let watchers = {};
        let states = {};

        function reloadService(subFolder) {
            return unloadService(subFolder).then(()=>loadService(subFolder));
        }

        function loadService(subFolder) {

            let servicePath = path.join(folder, subFolder);
            return moin.load(servicePath)
                .then(service=> {
                    let init = false;

                    function checkFSChange(path) {
                        if (!init)return;
                        if (path == "index.js" || path == "package.json") {
                            reloadService(subFolder);
                        }
                    }

                    watchers[subFolder] = chokidar.watch(servicePath, {depth: 0, cwd: servicePath})
                        .on('add', checkFSChange)
                        .on('change', checkFSChange)
                        .on('unlink', checkFSChange).on("ready", ()=> {
                            init = true
                        });

                    if (service == null || service.getType() != "service") {
                        states[subFolder] = INVALID;
                        return false;
                    }

                    return moin.loadService(service)
                        .then(function (id) {
                            loaded[subFolder] = id;
                            states[subFolder] = LOADED;
                            idMap.set(id, ()=>reloadService(subFolder));
                        }, function (err) {
                            states[subFolder] = INVALID;
                        });
                });
        }

        function unloadService(path) {
            if (states.hasOwnProperty(path)) {
                watchers[path].close();
                delete watchers[path];
                if (states[path] == LOADED) {
                    let promise = moin.unloadService(loaded[path]);
                    delete loaded[path];
                    delete states[path];
                    return promise;
                } else {
                    delete states[path];
                }
            }
            return Promise.resolve();
        }

        let watcher = chokidar.watch(folder, {
            ignored: /[\/\\]\./,
            depth: 0,
            cwd: folder
        });

        watcher
            .on('addDir', path => {
                if (path != "") {
                    loadService(path);
                }
            })
            .on('unlinkDir', path => {
                unloadService(path);
            });
    }


    moin.registerMethod("addServiceFolder", function (folder, options = {}) {
        return getRealFolder(folder).then(folder=>loadFolder(folder));
    });
    moin.on("serviceChanged", function (id) {
        if (idMap.has(id))idMap.get(id)();
    });

    if (settings.serviceFolders.length > 0) {
        settings.serviceFolders.forEach(folder=>moin.addServiceFolder(folder));
    }

};