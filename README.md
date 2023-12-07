# *CS 536 Final Project - 'WeRTC' WebRTC App*

*Our app, WeRTC, enables real time communciation using WebRTC.* 

*Instructions to compile and execute the code below*

## Capabilities
- Real-time video and audio communication
- Create "rooms" for peer-to-peer communication
- Select media devices for audio input, output, and video
- Real-time text chat
- Fast image file transfer
- Simple name identification system

## How To Run / Compile and Execute

### *Option 1: Visit Our Deployed*

Open our web app online: https://fir-rtc-792d0.web.app/

### *Option 2: Manual Set Up*

There is no immediate way to run our app, as it is integrated with Firebase Firestore database, which is part of Google's cloud development platform. We implemented our WebRTC signaling server using this service. So, to run the app at full functionality, one must perform further set up and installations.

### Steps

After downloading our source code and files:

1. Navigate to Firebase (https://firebase.google.com/), create an account or sign in, and create a project in the console. Note down the project ID, which is given when the project is created.
2. Enable Cloud Firestore in the console. Do this by navigating to the console menu's Develop section, click Database, then click Create database, and start the database in test mode (there will be an option).
3. In our provided files, find file `.firebaserc`. Find the projects-default value, and set it to your new Firebase project ID.
4. To host our Firebase signaling server locally, we need Firebase CLI. Download and install the Firebase CLI (https://firebase.google.com/docs/cli) by running `npm -g install firebase-tools` (Node.js npm is required for this step).
5. Verify that the CLI has been successfully installed using `firebase --version` in the console.
6. Authorize Firebase CLI by running `firebase login`, and proceed to login to your Firebase account.
7. In the source code root directory (i.e., the folder that contains public/ directory as an immediate subdirectory), run the `firebase serve --only hosting`.
9. You should see a response of `hosting: Local server: http://localhost:5000`. Open the web app at this localhost URL.