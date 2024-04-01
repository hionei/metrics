export const currentUnixTime = () => {
  return Math.floor(Date.now() / 1000);
};

export const weiToEther = (value: number) => {
  return Math.floor(value / 10 ** 18);
};
