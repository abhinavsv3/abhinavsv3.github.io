---
layout: posts
title: "How to “Push It Good” to Git"
---

A couple of days back I saw a tweet regarding [Push it to Good to Git in MAC][]. It was interesting so I built up a quick hack to emulate the same on linux.

I was initially looking to use Sound Cloud API coz well spotify doesn't work in India yet! Just then yesterday [Dilawar][] wrote an interesting post on [configuring Music Player Daemon][] on [WnCC Google Group][]
So I just wrote a mini bash to emulate the push it to good to git for MAC!

###What does this do?###
Everytime you push to your repository via `pushit`, it'll play the [Push it By Salt N Pepa][] song! Oh ofcourse you can change the song to your own favorite version by tweaking the bash file!

###Instructions###
{% highlight bash linenos %}
	   Configure MPC and download all the dependencies from gist!
		chmod +rx pushit
		sudo mv pushit /usr/bin/
{% endhighlight %}

###Usage###
Use `pushit {branch-name}` instead of `git push origin {branch-name}`

###Credits###
* Inspired by [Push it to Good to Git in MAC][]
* Credits to configure mpc [Dilawar][]
* [Push it By Salt N Pepa][] Youtube link!

###Code###
The entire code with dependencies is up on [gist][]
{% gist 8065556 pushit %}

[Push it to Good to Git in MAC]:http://valeriecoffman.com/git-push-it-good-salt-n-pepa/
[Push it By Salt N Pepa]:http://www.youtube.com/watch?v=vCadcBR95oUhttp://www.youtube.com/watch?v=vCadcBR95oU
[WnCC Google Group]: https://groups.google.com/forum/#!forum/wncc_iitb
[configuring Music Player Daemon]: https://groups.google.com/forum/#!topic/wncc_iitb/UEodzMhLBVE
[Dilawar]:https://plus.google.com/u/0/+DilawarSingh/
[gist]:https://gist.github.com/sushant-hiray/8065556
