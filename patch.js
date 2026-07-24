const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

// Find the Sign Out button to add the email next to it
const target = `<Button onClick={() => signOut(auth)} type="secondary">Sign Out</Button>`;
const replacement = `<div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Text type="supporting" color="secondary">{user.email}</Text>
          <Button onClick={() => signOut(auth)} type="secondary">Sign Out</Button>
        </div>`;

code = code.replace(target, replacement);

fs.writeFileSync('src/App.tsx', code);
