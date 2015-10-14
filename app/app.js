var app = angular.module('spot-tools', ['ui.router', 'spotify'])

app.config(function($stateProvider, $urlRouterProvider, SpotifyProvider) {

  // Set up Spotify service
  var spotifyToken = localStorage.getItem('spotify-token');

  SpotifyProvider.setClientId('6b725f378dd14258a0a34bfc5c858965');
  SpotifyProvider.setRedirectUri('http://localhost:8000/app/auth');
  SpotifyProvider.setScope([
    'playlist-modify-public',
    'playlist-modify-private',
    'playlist-read-private',
    'user-read-email'
  ].join(' '));
  if (spotifyToken) {
    SpotifyProvider.setAuthToken(spotifyToken);
  }

  // For any unmatched url, redirect to /home
  $urlRouterProvider.otherwise("/");

  // Configure states
  $stateProvider
    .state('home', {
      url: '/',
      controller:'HomeController',
      templateUrl:'app/partials/home.html',
    })
    .state('auth', {
      url: '/auth',
      templateUrl:'auth/callback-template.html'
    })
    .state('compare', {
      url: '/compare/:userId/:playlistId',
      controller:'CompareController',
      templateUrl:'app/partials/compare.html',
    })
    .state('copy', {
      url: '/copy/:userId/:playlistId',
      controller:'CopyController',
      templateUrl:'app/partials/copy.html',
    });
})

.directive('bootstrapTooltip', function() {
   return function(scope, elem) {
      $(elem).tooltip();
   }
})

.controller('HomeController', function($scope, $state, Spotify) {

  $scope.spotifyUsers = {};

  $scope.initLogin = function() {
    Spotify.login();
  };

  $scope.isAuthed = function() {
    return localStorage.getItem('spotify-token') != null;
  };

  $scope.loadSongs = function(userId, playlistId) {
    if (!$scope.isAuthed()) return;

    Spotify.getPlaylistTracks(userId, playlistId)
      .then(function(songs) {
        $scope.songs = songs;
      });
  };

  $scope.getPlaylistOwnerName = function(playlist) {
    if (playlist.owner.id == $scope.currentUser.id) {
      return 'You!';
    } else if ($scope.spotifyUsers[playlist.owner.id]) {
      return $scope.spotifyUsers[playlist.owner.id].display_name;
    } else {
      return 'Somebody else...';
    }
  };

  $scope.comparePlaylist = function(userId, playlistId) {
    $state.go('compare', { userId: userId, playlistId: playlistId });
  }

  $scope.copyPlaylist = function(userId, playlistId) {
    $state.go('copy', { userId: userId, playlistId: playlistId });
  }

  $scope.init = function() {
    if ($scope.isAuthed()) {
      Spotify.getCurrentUser()
        .then(function(user) {
          $scope.currentUser = user;
          $scope.spotifyUsers[user.id] = user;
          return Spotify.getUserPlaylists(user.id);
        }, function(errorObj) {
          switch (errorObj.error.status) {
            case 401: // Unauthorized! The token must be invalid.
              localStorage.removeItem('spotify-token')
              break;
          }
        })
        .then(function(playlists) {
          $scope.playlists = playlists;
          _.each(playlists.items, function(playlist) {
            Spotify.getUser(playlist.owner.id)
              .then(function(user) {
                $scope.spotifyUsers[user.id] = user;
              });
          });
        });
    }
  }

  $scope.init();
})

.controller('CompareController', function($scope, $state, $stateParams, Spotify) {

  var addToTrackMap = function(track) {
    var track = track.track;
    if ($scope.trackMap[track.id]) {
      $scope.trackMap[track.id] += 1;
    } else {
      $scope.trackMap[track.id] = 1;
    }
  };

  $scope.spotifyUsers = {};
  $scope.playlist = {};
  $scope.otherPlaylist = {};
  $scope.trackMap = {};
  $scope.otherTrackMap = {};

  $scope.initLogin = function() {
    Spotify.login();
  };

  $scope.isAuthed = function() {
    return localStorage.getItem('spotify-token') != null;
  };

  $scope.playlistString = function(playlist) {
    if (!playlist.name) {
      return null;
    }

    return 'Playlist: ' + playlist.name + ' (' + playlist.tracks.items.length + ' tracks)';
  }

  $scope.itemsInCommonCount = function() {
    return _.chain($scope.trackMap)
        .keys()
        .reject(function(trackId) { return !$scope.otherTrackMap[trackId]; })
        .value()
        .length;
  }

  $scope.addToPlaylist = function(playlist, track) {
    if (playlist.owner.id != $scope.currentUser.id) {
      return;
    }

    var self = this;

    Spotify.addPlaylistTracks(playlist.owner.id, playlist.id, [track.uri])
      .then(angular.bind({playlist: playlist, track: track}, function(data) {
        if ($scope.playlist.id == this.playlist.id) {
          $scope.playlist.tracks.items.push({track: this.track});
          $scope.trackMap[this.track.id] = 1;
        } else if ($scope.otherPlaylist.id == this.playlist.id) {
          $scope.otherPlaylist.tracks.items.push({track: this.track});
          $scope.otherTrackMap[this.track.id] = 1;
        }
      }));
  }

  $scope.tryGetPlaylistFromUri = function(isFirstPlaylist) {
    if (!$scope.otherPlaylistUri && !$scope.playlistUri) {
      return;
    }

    var regex = /spotify:user:(\d+):playlist:([A-Za-z0-9]+)/
    var match = isFirstPlaylist
        ? $scope.playlistUri.match(regex)
        : $scope.otherPlaylistUri.match(regex);

    if (!match) {
      return;
    }

    Spotify.getPlaylist(match[1], match[2])
      .then(function(playlist) {

        var addTracksToMap = function(track) {
          var track = track.track;
          if (isFirstPlaylist) {
            $scope.trackMap[track.id] = 1;
          } else {
            $scope.otherTrackMap[track.id] = 1;
          }
        };

        var maybeKeepLoadingTracks = function(playlistTracks) {
          var defaultLimit = 100;
          var itemsReceived = playlistTracks.offset + defaultLimit;
          if (itemsReceived < playlistTracks.total) {
            loadMoreTracks(itemsReceived, defaultLimit);
          }
        }

        var loadMoreTracks = function(itemsReceived, defaultLimit) {
            Spotify.getPlaylistTracks(
              playlist.owner.id,
              playlist.id,
              { offset: itemsReceived, limit: defaultLimit }
            ).then(function(playlistTracks) {
              Array.prototype.push.apply(
                  isFirstPlaylist
                      ? $scope.playlist.tracks.items
                      : $scope.otherPlaylist.tracks.items,
                  playlistTracks.items);
              _.each(playlistTracks.items, addTracksToMap);
              maybeKeepLoadingTracks(playlistTracks);
            });
        }

        if (isFirstPlaylist) {
          $scope.playlist = playlist;
        } else {
          $scope.otherPlaylist = playlist;
        }
        _.each(playlist.tracks.items, addTracksToMap);
        maybeKeepLoadingTracks(playlist.tracks);
      });
  };

  $scope.init = function() {
    // Grab and set the current user
    Spotify.getCurrentUser()
      .then(function(user) {
        $scope.currentUser = user;
        $scope.spotifyUsers[user.id] = user;
        return Spotify.getUserPlaylists(user.id);
      }, function(errorObj) {
        switch (errorObj.error.status) {
          case 401: // Unauthorized! The token must be invalid.
            localStorage.removeItem('spotify-token')
            break;
        }
      });

    // Grab the user that was passed.
    // It could very easily be different than the current user
    Spotify.getUser($stateParams.userId)
      .then(function(user) {
        $scope.spotifyUsers[user.id] = user;
      });

    // Get the playlist passed in the URL (from the home page).
    Spotify.getPlaylist($stateParams.userId, $stateParams.playlistId)
      .then(function(playlist) {

        var addTracksToMap = function(track) {
          var track = track.track;
          $scope.trackMap[track.id] = 1;
        };

        var maybeKeepLoadingTracks = function(playlistTracks) {
          var defaultLimit = 100;
          var itemsReceived = playlistTracks.offset + defaultLimit;
          if (itemsReceived < playlistTracks.total) {
            loadMoreTracks(itemsReceived, defaultLimit);
          }
        }

        var loadMoreTracks = function(itemsReceived, defaultLimit) {
            Spotify.getPlaylistTracks(
              $stateParams.userId,
              $stateParams.playlistId,
              { offset: itemsReceived, limit: defaultLimit }
            ).then(function(playlistTracks) {
              Array.prototype.push.apply($scope.playlist.tracks.items, playlistTracks.items);
              _.each(playlistTracks.items, addTracksToMap);
              maybeKeepLoadingTracks(playlistTracks);
            });
        }

        $scope.playlist = playlist;
        _.each(playlist.tracks.items, addTracksToMap);
        maybeKeepLoadingTracks(playlist.tracks);
      });
  };

  $scope.init();
})

.controller('CopyController', function($q, $scope, $state, $stateParams, Spotify) {

  $scope.spotifyUsers = {};
  $scope.copyTracks = {};

  $scope.initLogin = function() {
    Spotify.login();
  };

  $scope.isAuthed = function() {
    return localStorage.getItem('spotify-token') != null;
  };

  $scope.selectedTrackCount = function() {
    var a = _.chain($scope.copyTracks).values().filter(function(elem) { return elem; });
    return a.value().length;
  };

  $scope.copyButtonText = function() {
    if ($scope.selectedTrackCount() == 0) {
      return 'Select some tracks!';
    } else {
      return 'Copy ' + $scope.selectedTrackCount() + ' tracks.'
    }
  };

  $scope.updateCopyList = function() {
    _.each($scope.playlist.tracks.items, function(item) {
      $scope.copyTracks[item.track.uri] = $scope.allTracksSelected;
    });
  };

  $scope.copyPlaylistTracks = function() {
    $scope.errorText = '';

    if (!$scope.newPlaylistTitle) {
      $scope.errorText = 'You didn\'t give the playlist a name!'
      return;
    }

    Spotify.createPlaylist($scope.currentUser.id, { name: $scope.newPlaylistTitle })
      .then(function(playlist) {
        $scope.playlist = playlist;
        var tracks =
            _.chain($scope.copyTracks)
            .pairs()
            .filter(function(pair) { return pair[1]; })
            .map(function(pair) { return pair[0]; })
            ;

        var promises = [];
        do {
          promises.push(
            Spotify.addPlaylistTracks($scope.currentUser.id, playlist.id, tracks.take(100).value()));

          tracks = tracks.drop(100);
        } while (tracks.value().length > 0);
        return $q.all(promises);
      }).then(function(success) {
        // refresh the playlist after adding tracks
        return Spotify.getPlaylist($scope.playlist.owner.id, $scope.playlist.id);
      }).then(function(playlist) {
        $scope.playlist = playlist;
        $scope.maybeKeepLoadingTracks(playlist.tracks);
        return Spotify.getUser(playlist.owner.id);
      })
      .then(function(playlistOwner) {
        $scope.spotifyUsers[playlistOwner.id] = playlistOwner;
      });
  };

  $scope.maybeKeepLoadingTracks = function(playlistTracks) {
    var defaultLimit = 100;
    var itemsReceived = playlistTracks.offset + defaultLimit;
    if (itemsReceived < playlistTracks.total) {
      $scope.loadMoreTracks(itemsReceived, defaultLimit);
    }
  }

  $scope.loadMoreTracks = function(itemsReceived, defaultLimit) {
      Spotify.getPlaylistTracks(
        $stateParams.userId,
        $stateParams.playlistId,
        { offset: itemsReceived, limit: defaultLimit }
      ).then(function(playlistTracks) {
        Array.prototype.push.apply($scope.playlist.tracks.items, playlistTracks.items);
        $scope.maybeKeepLoadingTracks(playlistTracks);
      });
  }

  $scope.getPlaylistTitleString = function() {
    var s = '';
    if ($scope.playlist) {
      s += $scope.playlist.name;
      if ($scope.spotifyUsers[$scope.playlist.owner.id]) {
        s += ' by ' + $scope.spotifyUsers[$scope.playlist.owner.id].display_name;
      }
    }
    return s;
  };

  $scope.init = function() {
    if ($scope.isAuthed()) {
      Spotify.getCurrentUser()
        .then(function(user) {
          $scope.currentUser = user;
          $scope.spotifyUsers[user.id] = user;
          return Spotify.getPlaylist($stateParams.userId, $stateParams.playlistId);
        }, function(errorObj) {
          switch (errorObj.error.status) {
            case 401: // Unauthorized! The token must be invalid.
              localStorage.removeItem('spotify-token')
              break;
          }
        })
        .then(function(playlist) {
          $scope.playlist = playlist;
          $scope.maybeKeepLoadingTracks(playlist.tracks);
          return Spotify.getUser(playlist.owner.id);
        })
        .then(function(playlistOwner) {
          $scope.spotifyUsers[playlistOwner.id] = playlistOwner;
        });
    }
  }

  $scope.init();
})
