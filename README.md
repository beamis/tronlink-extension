# LitetokensLink
[View LitetokensLink on the Chrome Webstore](https://chrome.google.com/webstore/detail/ibnejdfjmmkpcnlpebklmnkoeoihofec)

LitetokensLink is a Browser Extension for Website to Blockchain intercommunication on the Litetokens Network.  
It allows developers to integrate smart contract calls on their site, in turn enabling the use of
Dapps from within the browser. It also functions as a standard Litetokens wallet for anybody wanting to
broadcast and receive transactions on the network.

LitetokensLink v2 uses lerna and yarn workspaces as a monorepo.

At the moment, webpack and ESLint run at the root of the project. This does
not follow the pattern for lerna, it should instead have a "@litetokenslink/tools"
package. This would then host webpack and ESLint along with its configuration,
which can then be used by the other packages.

`backgroundScript` currently holds the webpack dependencies. The root workspace
holds the ESLint dependencies.


Build Instructions:
```
git clone https://github.com/LitetokensWatch/LitetokensLink/
yarn install
lerna bootstrap
yarn build
```

You can then load the root folder as an unpacked Chrome Extension in Chrome.