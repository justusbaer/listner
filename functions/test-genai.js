const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({
  project: 'listner-mvp-justus',
  location: 'us-central1',
  vertexai: true
});
async function run() {
  try {
    const models = await ai.models.list();
    for await (const model of models) {
      if (model.name.includes('3.5')) console.log(model.name);
    }
    console.log("Done");
  } catch (e) {
    console.error(e);
  }
}
run();
