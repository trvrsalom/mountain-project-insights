var express = require('express');
var router = express.Router();
var request = require('request');
var jsdom = require('jsdom');
var async = require('async');
var afar = require('afar');
var mpSecretKey = process.env.MPSECRETKEY;

var cache = {}
var emailMap = {}
var favoriteCount = 3;

var validateEmail = function(email)  {
  var re = /^(?:[a-z0-9!#$%&amp;'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&amp;'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/;
  return re.test(email);
};

var processUser = function(u, res) {
  var data = {
    ret: {
      hardest: "", 
      average: "",
      since: "",
      favs: "",
      favLinks: "",
      totalHeight: 0,
      totalDistance: 0,
      totalPitches: 0,
      title: "Mountain Project Insights",
      userId: u.id,
      routeCounts: 0
    },
    user: u,
    response: res,
    favoriteClimbs: [],
    favoriteClimbNames: [],
    favoriteClimbLinks: [],
    tickIds: [],
    ticks: []
  };
  getTicks(data, res);
};

var getTicks = function(data, res) {
  var user = data.user
  var url = "https://www.mountainproject.com/data/get-ticks?userId=" + user.id;
  url = addKey(url);
  request(url, function(error, response, body) {
    data.ticks = JSON.parse(body);
    data.ret.routeCounts = data.ticks.ticks.length;
    for(var i = 0; i < data.ticks.ticks.length; i++) {
      data.tickIds.push(data.ticks.ticks[i].routeId);
    };
    var dateArr = data.ticks.ticks[data.ticks.ticks.length - 1].date.split("-").reverse();
    var month = dateArr.splice(1,1);
    dateArr.splice(0,0,month);
    data.ret.since = dateArr.join("/");
    data.ret.hardest = data.ticks.hardest;
    data.ret.average = data.ticks.average;
    async.parallel({
      routeHeight: function(callback) {
        getRouteHeight(data, callback);
      },
      routeData: function(callback) {
        getRouteData(data, callback);
      }
    }, function(err, results) {
      if(err) console.error(err);
      doneLoading(data, res);
    });
  });
};

var doneLoading = function(data, res){
  data.ret.favs = data.favoriteClimbNames;
  data.ret.favLinks = data.favoriteClimbLinks;
  data.ret.name = data.user.name;
  data.ret.userUrl = data.user.url;
  data.ret.userAvatar = data.user.avatar;
  data.ret.totalHeight = commaSeparateNumber(Math.ceil(data.ret.totalHeight));
  data.ret.totalDistance = commaSeparateNumber(Math.ceil(data.ret.totalDistance));
  cache[data.ret.userId] = data.ret;
  if(data.user.email) {
    emailMap[data.user.email] = data.ret.userId;
  }
  res.redirect("/user/" + data.ret.userId);
}

var getFavoriteClimbs = function(data) {
  var ticksByRating = data.ticks.ticks.slice().sort((a, b) => - (a.userStars - b.userStars));
  var ratedClimbs = 0;
  for(var i = 0; i < favoriteCount; i++) {
    if(ticksByRating[i].userStars > 0) data.favoriteClimbs.push(ticksByRating[i].routeId);
  }
}

var getRouteHeight = function(data, finalCallback) {
  async.each(data.tickIds, function(routeIdx, callback) {
    var url = "https://www.mountainproject.com/route/" + routeIdx;
    request(url, function(error, response, body) {
      var {JSDOM} = jsdom;
      var dom = new JSDOM(body);
      $ = (require('jquery'))(dom.window);
      var routeInfo = $($(".description-details").find('td')[1]).html();
      var re = /([0-9]{1,5})(?= ?[fm])+/g;
      var height = re.exec(routeInfo);
      if(height) {
        height = parseInt(height[0]);
        if(!isNaN(height))
          data.ret.totalHeight += height;
      }
      callback();
    });
  }, function(err){
    if(err) console.error(err);
    finalCallback();
  });
}

var getRouteData = function(data, finalCallback) {
  var routesArr = data.tickIds.slice(0, data.tickIds.length >= 199 ? 199 : data.tickIds.length);
  var routeStr = routesArr.join(",");
  var url = "https://www.mountainproject.com/data/get-routes?routeIds=" + routeStr;
  url = addKey(url);
  getFavoriteClimbs(data);
  request(url, function(error, response, body) {
    var routes = JSON.parse(body).routes;
    data.coords = [];
    for(var i = 0; i < routes.length; i++) {
      if(data.favoriteClimbs.indexOf(routes[i].id) >= 0) {
        data.favoriteClimbNames.push(routes[i].name);
        data.favoriteClimbLinks.push("https://www.mountainproject.com/route/" + routes[i].id);
      }
      data.coords[i] = {};
    }
    async.each(routes, function(route, callback) {
      data.ret.totalPitches += route.pitches ? route.pitches : 1
      var idx = routesArr.indexOf(route.id);
      routes[idx] = {};
      var date = ""; 
      if(idx < 0) {
        callback();
      }
      else {
        date = data.ticks.ticks[idx].date;
        data.coords[idx] = {latitude: route.latitude, longitude: route.longitude, date: date};
        callback();
      }
    }, function(err) {
      if(err) console.error(err);
      data.coords = data.coords.filter(value => Object.keys(value).length !== 0);
      var last = data.coords[0];
      for(var i = 1; i < data.coords.length; i++) {
        if(data.coords[i].latitude == last.latitude && data.coords[i].longitude == last.longitude) {
          continue;
        } else {
          var dist = afar(last.latitude, last.longitude, data.coords[i].latitude, data.coords[i].longitude);
          if(isNaN(dist)) {
            console.warn("Invalid distance")
            continue; 
          }
          last = data.coords[i];
          data.ret.totalDistance += dist;
        }
        data.ret.totalDistance *= 0.6213712;
      }
      finalCallback();
    })
  });
}

var addKey = function(src) {
  return src + "&key=" + mpSecretKey;
}

var commaSeparateNumber = function(val){
  val = "" + val;
  return val.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,");
}

router.get('/', function(req, res, next) {
    res.render('index', { title: 'Mountain Project Insights' });
});

router.get('/search', function(req, res) {
  res.redirect('/');
});

router.post('/search', function(req, res) { 
  var url = "https://www.mountainproject.com/data/get-user?";
  if(req.body.user) {
    url += "userId=" + req.body.user;
  } else if(req.body.email) {
    url += "email=" + req.body.email;
  }
  url = addKey(url);
  if(emailMap[req.body.email]) {
    var userid = emailMap[req.body.email]
    if(cache[userid]) {
      res.redirect('/user/' + userid);
    }
  }
  request(url, function (error, response, body) {
    try {
      var user = JSON.parse(body);
      if(req.body.email) {
        user.email = req.body.email
      }
      processUser(user, res);
    } catch (e) {
      res.render('index', { title: 'Mountain Project Insights', error: "Something went wrong. Maybe you should try again?"});
    }
  });
});

router.get("/user/:id", function(req, res) {
  if(Object.keys(cache).indexOf(req.params.id) < 0) {
    var url = "https://www.mountainproject.com/data/get-user?userId=" + req.params.id;
    url = addKey(url);
    request(url, function (error, response, body) {
      processUser(JSON.parse(body), res);
    });
  } else {
    res.render('display', cache[req.params.id]);
  }
});

router.get("/reset/:id", function(req, res) {
  try {
    delete cache[req.params.id];
    var email = userMap.keys()[userMap.values().indexOf(req.params.id)];
    delete userMap[email]
  } finally {
    res.redirect("/user/" + req.params.id);
  }
})

module.exports = router;
