const request = require("request"),
      process = require("child_process");
      player = require("player"),
      later = require("later"),
      fs = require("fs"),
      util = require("util");

var utils = require("./utils.js");

var config = {
    groups: [
        "e_music",
        "progressivemetal",
        "e_avantgarde",
        "e_music_progrock",
        "e_russian_chanson",
        "e_music_krautrock",
        "e_music_neoprog",
        "experimental_rock",
        "e_music_psychedelic",
    ],
    update_period: 60 // minutes
}

var groups_updated = {};

var playlist = [];

var files = [];

function next() {
    fs.unlink(playlist[0].file);
    playlist[0].file = null;
    playlist[0] = playlist[1];
    console.log(
        util.format(
            "Now playing: %s by %s from %s",
            playlist[0].title,
            playlist[0].artist,
            playlist[0].group
        )
    );
    new player(playlist[0].url).play(next);

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
                        console.log(
                            util.format(
                                "Now playing: %s by %s from %s",
                                playlist[0].title,
                                playlist[0].artist,
                                playlist[0].group
                            )
                        );
                        new player(playlist[0].file).play(next);
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
            count: 10,
            filter: "owner"
        }
    },
    function(error, response, body) {
        res = JSON.parse(body).response.slice(1); // first item is posts count
        for (var i=0; i<res.length; i++) {
            if (res[i].attachments && !res[i].is_pinned) {
                add_post(res[i], group_name);
            }
        }
        console.log(util.format("Updated %s.", group_name));
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