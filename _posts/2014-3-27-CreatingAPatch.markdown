---
layout: posts
title: "Creating a Patch - a simple demonstration"
---
Given below is a simple demostration of creating a patch for a file .

Follow the following steps :


1. Create 2 folders my_copy and upstream in the same directory.

	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm$ ls -l
	total 8
	drwxr-xr-x 2 abhinav abhinav 4096 Feb 14 13:55 my_copy
	drwxr-xr-x 2 abhinav abhinav 4096 Feb 14 13:48 upstream

xyz

2. Create a simple .c file named hello.c in upstream

	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/upstream$ cat hello.c
	#include<stdio.h>
	int main(){
		printf("Hello World");
		return 0;
	}

3. copy upstream's file hello.c into my_copy folder
	
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ cp ../upstream/hello.c .	
	
	\\	the last ' . ' represents the current folder 

4. Create a copy of this hello.c in hello_org.c 
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ cp hello.c hello_org.c

5. Make changes to the hello.c in the my_copy say , change "Hello World" to  "Hello SASTRA"
   NOTE :  Change in the hello.c in my_copy directory
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ cat hello.c
	#include<stdio.h>
	int main(){
		printf("Hello SASTRA");
		return 0;
	}
6. Let us see both the files
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ cat hello.c
	#include<stdio.h>
	int main(){
		printf("Hello SASTRA");
		return 0;
	}
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ cat hello_org.c
	#include<stdio.h>
	int main(){
		printf("Hello World");
		return 0;
	}
7. Let us create a patch

   A .  Create a difference of the two files : 
	The following is the diff output of the 2 file hello_world.c and hello.c
 
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ diff -Naurp hello_org.c hello.c
	
	--- hello_org.c	2014-02-14 13:48:31.039899000 +0530
	+++ hello.c	2014-02-14 13:55:51.939895038 +0530
	@@ -1,5 +1,5 @@
	 #include<stdio.h>
	 int main(){
	-	printf("Hello World");
	+	printf("Hello SASTRA");
	 	return 0;
	 }

   B .  Create a patch file by redirecting the output of the  to my.patch file  .  we will send only the patch file ,

	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ diff -Naurp hello_org.c hello.c > my.patch
	
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ ls
	hello.c  hello_org.c  my.patch

   
   C. patch file looks like this 

	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ cat my.patch
	--- hello_org.c	2014-02-14 13:48:31.039899000 +0530
	+++ hello.c	2014-02-14 13:55:51.939895038 +0530
	@@ -1,5 +1,5 @@
	 #include<stdio.h>
	 int main(){
	-	printf("Hello World");
	+	printf("Hello SASTRA");
	 	return 0;
	 }
8. SEND the patch to upstream ; here we copy it 

	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/my_copy$ cp my.patch ../upstream/

	once this is done we have our my.patch in the out upstream folder
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/upstream$ ls
	hello.c  my.patch

	


9. Applying the patch we use the 'patch' command in the upstream directory : 
	to do this we do the following input redirection : 
		patch -p0 < my.patch

	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/upstream$ patch -p0 < [my.patch]
	patching file hello.c
	
	 [,] is not required . That is given for simpler representation .

10. Now let us see the patched hello.c
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/upstream$ cat hello.c
	
	// #include<stdio.h>
	int main(){
		printf("Hello SASTRA");
		return 0;
	}

CONGRATS patch was created and APPLIED

11. CAN I reverse apply the patch ? YES .
  To reverse the patch we use -R option :	
	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/upstream$ patch -p0 -R  < [my.patch]
	patching file hello.c
  Lets us see the File now  :) .  Guess what ? File is reverse patched . YES!

	abhinav@abhinav-SVE15137CXW:~/homework/linuxibm/upstream$ cat hello.c
	
	#include<stdio.h>
	int main(){
		printf("Hello World");
		return 0;
	}
	
Thus a patch is Learnt :)



