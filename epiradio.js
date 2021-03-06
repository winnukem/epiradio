const request = require("request"),
      process = require("child_process");
      player = require("player"),
      later = require("later"),
      fs = require("fs"),
      util = require("util"),
      http = require("http"),
      socketio = require("socket.io"),
      fstatic = require("node-static");

var utils = require("./utils.js");

var config = JSON.parse(fs.readFileSync("config.json", "utf8"))

var groups_updated = {};

var playlist = [];

var files = [];

var current_player = null;

function next() {
    if (current_player) {
        current_player.stop();
    }

    fs.unlink(playlist[0].file);
    playlist[0].file = null;
    playlist[0] = playlist[1];
    io.sockets.emit(
        "playing",
        {
            nowplaying: util.format(
                "Now playing: %s by %s from %s",
                playlist[0].title,
                playlist[0].artist,
                playlist[0].group
            )
        }
    );

    current_player = new player(playlist[0].file);
    current_player.play(next);

    playlist[1] = utils.random_select(files);
    playlist[1].file = util.format(
        "./cache/%s",
        playlist[1].url.split("/").pop() // pop() is slower than [length-1], but clearer in this case
    );

    console.log(
        util.format(
            "Downloading: %s by %s",
            playlist[1].title,
            playlist[1].artist
        )
    );
    process.exec(
        util.format("wget %s -P cache", playlist[1].url),
        function (err, stdout, stderr) {
            console.log(util.format("Downloaded: %s by %s", playlist[1].title, playlist[1].artist));
        }
    );
}

function play() {
    if (!playlist.length) {
        for (var i=0; i<2; i++) {
            playlist[i] = utils.random_select(files);
            console.log(
                util.format(
                    "Downloading: %s by %s",
                    playlist[i].title,
                    playlist[i].artist
                )
            );
            playlist[i].file = util.format(
                "./cache/%s",
                playlist[i].url.split("/").pop()
            );
            if (i == 0) {
                process.exec(
                    util.format("wget %s -P cache", playlist[i].url),
                    function (err, stdout, stderr) {
                        io.sockets.emit(
                            "playing",
                            {
                                nowplaying: util.format(
                                    "Now playing: %s by %s from %s",
                                    playlist[0].title,
                                    playlist[0].artist,
                                    playlist[0].group
                                )
                            }
                        );
                        current_player = new player(playlist[0].file);
                        current_player.play(next);
                    }
                );
            } else {
                process.exec(
                    util.format("wget %s -P cache", playlist[i].url)
                );
            }
        }
    }
}

function add_audio(audio, group) {
    files.push({
            artist: audio.artist,
            title: audio.title,
            url: audio.url.split("?")[0],
            group: group
        }
    );
}

function add_post(post, group) {
    for (var i=0; i<post.attachments.length; i++) {
        if (post.attachments[i].type == "audio") {
            add_audio(post.attachments[i].audio, group);
        }
    }
}

function update_group(group_name) {
    request({
        uri: "https://api.vk.com/method/wall.get",
        method: "POST",
        form: {
            domain: group_name,
            count: 99,
            filter: "owner"
        }
    },
    function(error, response, body) {
        var earliest = new Date();
        earliest.setDate(earliest.getDate() - config.max_age);
        var min_date = earliest.getTime();
        var need_clean = true;
        for (group in groups_updated) {
            if (groups_updated[group]) {
                need_clean = false;
                break;
            }
        }
        if (need_clean) {
            files = [];
        }

        var parsed = JSON.parse(body);
        if (parsed.error) {
            console.log(util.format("Error while updating %s.", group_name));
        } else {
            res = parsed.response.slice(1); // first item is posts count
            for (var i=0; i<res.length; i++) {
                if (res[i].attachments && !res[i].is_pinned && 1000*res[i].date>=min_date) {
                    add_post(res[i], group_name);
                }
            }
            console.log(util.format("Updated %s.", group_name));
        }
        groups_updated[group_name] = true;
        for (group in groups_updated) {
            if (!groups_updated[group]) {
                return;
            }
        }
        console.log("Update finished.");
        if (!playlist.length) {
            play();
        }
    }
    );
}

function update_groups() {
    console.log("Updating...");
    for (var i=0; i<config.groups.length; i++) {
        groups_updated[config.groups[i]] = false;
        update_group(config.groups[i]);
    }
}

var sched = later.parse.recur().every(config.update_period).minute();
var timer = later.setInterval(update_groups, sched);

update_groups();

var file = new fstatic.Server("./static", {
    cache: 3600,
    gzip: true
});

var app = http.createServer(function(req, res) {
    req.addListener("end", function () {
        file.serve(req, res);
    }).resume();
});

var io = require("socket.io").listen(app);

io.sockets.on("connection", function(socket) {
    socket.on("sources", function(data) {
        console.log(data);
        config.groups = data.sources;
        fs.writeFile("config.json", JSON.stringify(config, null, 4), function(err) {
            if (err) {
                console.log(err);
            }
        });
        update_groups();
    });

    socket.on("next", function(data) {
        next();
    });

    socket.on("update_period", function(data) {
        config.update_period = parseInt(data.update_period);
        timer.clear();
        sched = later.parse.recur().every(config.update_period).minute();
        timer = later.setInterval(update_groups, sched);

        fs.writeFile("config.json", JSON.stringify(config, null, 4), function(err) {
            if (err) {
                console.log(err);
            }
        });
    });

    socket.on("max_age", function(data) {
        config.max_age = parseInt(data.max_age);

        fs.writeFile("config.json", JSON.stringify(config, null, 4), function(err) {
            if (err) {
                console.log(err);
            }
        });
        update_groups();
    });

    socket.emit(
        "sources",
        {
            sources: config.groups
        }
    );
    socket.emit(
        "update_period",
        {
            update_period: config.update_period
        }
    );
    socket.emit(
        "max_age",
        {
            max_age: config.max_age
        }
    );
    if (playlist.length > 0) {
        socket.emit(
            "playing",
            {
                nowplaying: util.format(
                    "Now playing: %s by %s from %s",
                    playlist[0].title,
                    playlist[0].artist,
                    playlist[0].group
                )
            }
        );
    }
});

app.listen(3000);