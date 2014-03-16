---
layout: posts
title: "Y U NO USE screen"
---

Imagine a fairly common situation — you are ssh'ed to a remote server, doing stuff and then all of a sudden your internet connection drops and the console has frozen. And even after the connection is back, console won't respond, because the pipe between your computer and remote one has broken.

We’ve all been there, it sucks. And it sucks even more if there was a long running process executed from that console say for example `scp`ing a huge file.


Well I faced this situation quite some times while working for our compiler's lab assignment this weekend and it pissed me enough to search for a solution!

There is a very old and simple tool, that can help you to prevent this from happening. It is called — `GNU Screen`. I had a faint remembrance of seeing [Manish](https://www.facebook.com/manish.goregaokar) use it, so I decided to explore it a bit more. Basically, screen allows you to create a virtual session inside your ssh session(or any console session), that isn’t bound to your connection. Meaning that if your connection drops, you will be able to connect to this virtual session afterwards. Hopefully, you already see the benefits you can get from using it, so let’s get to how you actually use it. 




##1. Installing screen

Usually screen won’t be installed your system, so you would:

	sudo apt-get install screen

or

	yum install screen

or

	brew install screen

or do whatever you do to install stuff on your machine.


##2. Starting a new screen session

To start and new virtual session simply type `screen` into your console. Normally it would greet you with a copyright notice. Press return to skip it and you’re set — now you are inside the virtual console. Feels pretty much the same, right? Except now you can go ahead and disconnect from the internet and you will be able to connect to the session once you are back online.


##3. Communicating with screen

Inside a virtual session you can initiate communication with the screen tool by pressing `Ctrl + A`, followed by a single letter command:

`D` — ‘detach’. It detaches you from current session, leaving it running in background.
 
`K` — ‘kill’. This would terminate the screen session. It would probably ask you to confirm this, so press y if you are sure about it. Logging out from a virtual console also terminates it.

These are two commands that you would need for basic understanding of screen, but ofcourse, as most of the UNIX tools, `screen` has much more power underneath the bonet.


##4. Connecting to an existings virtual session

In case of a lost connection or to resume a previously started session, you need to type

	screen -r

This command will attach you to a screen session. In case there are more then one active session, you’ll see a list of them. To connect to a particular screen, simply add it’s identifier as an argument:

	screen -r 12345.pts-0.yourserver

That way you can have multiple sessions running, allowing you to switch between them and not having to keep multiple ssh connections alive. To see a list of active screens, just type in:

	screen -ls

##5. Naming your screens

You can also give your screen a name, that you can use later on as a connection identifier:

	screen -S something

and to restore that session:

	screen -r something

And that’s basically it. With these few simple commands in mind you won’t be afraid of a frozen consoles and “Broken pipe” error messages, because your session is safe and sound with screen. So go ahead try it and get used to it, because it will help you a lot.

ps: The title is motivated by a blogpost I recently saw being shared on [Hacker News](http://news.ycombinator.com)