const fs = require('fs');
const html = fs.readFileSync('/Users/justus/.gemini/antigravity/brain/f36d0206-50dc-4e6e-848b-a77dd4e872b3/.system_generated/steps/1641/content.md', 'utf-8');

// find all occurrences of gemini-3.5-flash
const matches = html.matchAll(/gemini-3\.5-flash/g);
for (const match of matches) {
  const context = html.substring(match.index - 500, match.index + 500);
  if (context.includes('compare-yes')) {
     console.log("Found support!");
     // find the closest preceding table header
     const thMatch = html.substring(0, match.index).match(/<th[^>]*>.*?<\/th>/g);
     if (thMatch) {
       console.log("Headers around here:", thMatch.slice(-5));
     }
  }
}
