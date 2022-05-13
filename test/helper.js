const web3 = require("web3");

const toMwei = (amount) => {
  return web3.utils.toWei(amount.toString(), "mwei");
};

const toGwei = (amount) => {
  return web3.utils.toWei(amount.toString(), "gwei");
};

const toWei = (amount) => {
  return web3.utils.toWei(amount.toString());
};

const fromMwei = (amount) => {
  return web3.utils.fromWei(amount.toString(), "mwei");
};

const fromGwei = (amount) => {
  return web3.utils.fromWei(amount.toString(), "gwei");
};

const fromWei = (amount) => {
  return ethers.utils.formatEther(amount);
};

const tokenSorted = (address1, address2) => {
  return address1 < address2 ? true : false;
};

module.exports = {
  toMwei,
  toGwei,
  toWei,
  fromMwei,
  fromGwei,
  fromWei,
  tokenSorted,
};
