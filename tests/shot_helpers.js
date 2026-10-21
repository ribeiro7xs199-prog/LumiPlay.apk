const {sleep} = require("./harness");
// Rola a página aos poucos para disparar o carregamento preguiçoso de imagens.
async function scrollAll(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate(v => window.scrollTo(0, v), y); await sleep(60); }
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(250);
}
module.exports = {scrollAll};
