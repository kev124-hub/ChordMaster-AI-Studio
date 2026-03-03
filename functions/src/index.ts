import * as admin from "firebase-admin";

// Initialise the Admin SDK once, before any function imports.
admin.initializeApp();

export { analyzeTrack, identifySong } from "./analyzeTrack";
export { analyzeUpload } from "./analyzeUpload";
