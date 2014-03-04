---
layout: posts
title: "Setting up post-receive hook"
---

Recently, we switched to using [Jekyll](http://jekyllrb.com/) for our [WnCC](http://wncc-iitb.org/) website.
This post will essentially help to configure `post-receive hooks` on your local repository.

Using git hooks you no longer need to manually deploy the website on your server. Everytime you push to git, a remote server handles the deployment.

Setting up the post-receive hook is done as follows:


	laptop$ ssh deployer@example.com
	server$ mkdir myrepo.git
	server$ cd myrepo.git
	server$ git --bare init
	server$ cp hooks/post-receive.sample hooks/post-receive
	server$ mkdir /var/www/myrepo


Next, add the following lines to `hooks/post-receive` and be sure `Jekyll` is installed on the server:


	GIT_REPO=$HOME/myrepo.git
	TMP_GIT_CLONE=$HOME/tmp/myrepo
	PUBLIC_WWW=/var/www/myrepo
	JEKYLL = /path/to/jekyll
	git clone $GIT_REPO $TMP_GIT_CLONE
	$JEKYLL build -s $TMP_GIT_CLONE -d $PUBLIC_WWW
	rm -Rf $TMP_GIT_CLONE
	exit

Finally, run the following command on any users laptop that needs to be able to deploy using this hook:


	laptops$ git remote add deploy deployer@example.com:~/myrepo.git


Everytime you push, make sure you push it to remote server as well


	laptops$ git push deploy master


In case, you wish multiple users to be able to deploy
You need to run the following command on the other laptops:

	
	laptops$ git remote add deploy deployer@example.com:~/myrepo.git


Ofcourse goes without saying, each user should deploy to remote server using:


	laptops$ git push deploy master


In case you are maintaining the repository on github as well, make sure to sync the repositories.
So, your `git push` could look as follows:


	laptops$ git push deploy master
	laptops$ git push origin master


