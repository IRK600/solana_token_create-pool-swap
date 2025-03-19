const fs = require('fs');
const readline = require('readline');
//header
const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js')
const {
    Token,
    Percent,
    TokenAmount,
    TOKEN_PROGRAM_ID
} = require('@raydium-io/raydium-sdk')

const { createToken } = require('./src/create_token.js')
const { createMarket } = require('./src/create_market.js')
const { createPool } = require('./src/create_pool.js')
const { execSwap } = require('./src/exec_swap.js')

const {
    connection,
    myKeyPair,
    DEFAULT_TOKEN,
} = require('./config.js')

const {
    getWalletTokenAccount,
    sleepTime
} = require('./src/util.js')

const prompt = require('prompt-sync')({ sigint: true });
const BN = require('bn.js');

require('dotenv').config({ path: `.env.${process.env.NETWORK}` })

// const secretKeyString = fs.readFileSync('./id.json', 'utf8');
// const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
// const keypair = solanaWeb3.Keypair.fromSecretKey(secretKey);

const minimumSOLBalance = 4;

main()

async function main() {
    // get account SOL balance
    const address = new PublicKey(process.env.PUBLIC_KEY);
    const balance = await connection.getBalance(address);
    const balanceInSol = balance / LAMPORTS_PER_SOL;
    console.log(`Deployer account Balance: ${balanceInSol} SOL\n`);

    if (balanceInSol < minimumSOLBalance) {
        console.log("Insufficient SOL balance in the account. Please ensure a minimum of", minimumSOLBalance, "SOL is secured to prevent transaction failures.");
        process.exit(1);
    }
    console.log("...Token Info Input...")
    const amount = Number(prompt('amount(default: 10000): ')) || 10000;
    let decimals = Number(prompt('decimals(default: 9): ')) || 9;
    while (decimals > 9 || decimals < 1) {
        console.log("Invalid decimal value, should be a value between 1 and 9");
        decimals = Number(prompt('decimals(default: 9): ')) || 9;
    }
    if (amount * 10 ** decimals > 18446744073709551615n) {
        console.log("invalid supply and decimal value, total supply should be less than 18,446,744,073,709,551,615, including decimals")
        return;
    }

    const symbol = prompt('symbol(default: "TMT"): ') || 'TMT';
    const tokenName = prompt('token name(default: "Test Mock Token"): ') || 'Test Mock Token';

    const tokenInfo = {
        amount,
        decimals,
        metadata: "",
        symbol,
        tokenName
    }

    console.log("\n...Market Info Input...")
    const lotTickMap = {
        0.001: 0.001,
        0.01: 0.0001,
        0.1: 0.00001,
        1: 0.000001,
        10: 0.0000001,
        100: 0.00000001,
        1000: 0.000000001,
        10000: 0.0000000001
    };

    const lotSize = Number(prompt('Lot Size(Choose higher for larger token supply, default: 1): ')) || 1;

    if (!Object.keys(lotTickMap).includes(lotSize.toString())) {
        // If not valid, prompt again
        console.log("Invalid lot size, should be one of following values.")
        console.log(Object.keys(lotTickMap))
        return;
    }
    const tickSize = lotTickMap[lotSize]
    console.log("Associated Tick Size :", tickSize);

    console.log("...Pool Info Input...")
    const addBaseAmountNumber = Number(prompt(`token amount for pool(default: ${amount}): `)) || amount;
    if (addBaseAmountNumber > amount) {
        console.log("Invalid value, should be less than total token supply")
        return;
    }

    const addQuoteAmountNumber = Number(prompt('SOL amount for pool(default: 1): ')) || 1;
    const totalSOLBalanceRequired = minimumSOLBalance + (addQuoteAmountNumber * 2)
    if (totalSOLBalanceRequired > balanceInSol) {
        console.log("Insufficient SOL balance to create the pool. Please ensure a minimum of", totalSOLBalanceRequired, "SOL is secured to prevent transaction failures. It will also used to secure token supply");
        return;
    }

    const poolLockTime = Number(prompt('pool available after _hours(default: 0): ')) || 0;

    console.log("...Swap Info Input...")
    const swapAmountInPercent = Number(prompt('Token amount to secure in percent(default: 20): ')) || 20;

    // Token info input

    console.log("Creating Token...")
    const mintAddress = await createToken(tokenInfo)

    console.log('tokenInfo', tokenInfo)

    const baseToken = new Token(TOKEN_PROGRAM_ID, new PublicKey(mintAddress), tokenInfo.decimals, tokenInfo.symbol, tokenInfo.tokenName)
    const quoteToken = DEFAULT_TOKEN.WSOL

    console.log("Creating Market...")
    const { marketId: targetMarketId, marketInfo } = await createMarket({
        baseToken,
        quoteToken,
        lotSize,
        tickSize,
        wallet: myKeyPair,
    })

    // create pool
    // const addBaseAmount = new BN(addBaseAmountNumber * (10 ** tokenInfo.decimals)) // custom token
    // const addQuoteAmount = new BN(addQuoteAmountNumber * (10 ** 9)) // WSOL

    // console.log("addBaseAmount", addBaseAmount)
    // console.log("addBaseAmount Number", addBaseAmount.toNumber())

    const addBaseAmount = new BN(addBaseAmountNumber).mul(new BN(10).pow(new BN(tokenInfo.decimals)));
    const addQuoteAmount = new BN(addQuoteAmountNumber).mul(new BN(10).pow(new BN(9)));

    console.log("addBaseAmount", addBaseAmount)
    console.log("addQuoteAmount", addQuoteAmount)

    const startTime = Math.floor(Date.now() / 1000) + poolLockTime * 60 * 60
    // const startTime = Math.floor(Date.now() / 1000) // start immediately

    // check if minted token appeared in wallet
    let walletTokenAccounts;
    let found = false;
    while (!found) {
        walletTokenAccounts = await getWalletTokenAccount(connection, myKeyPair.publicKey)
        walletTokenAccounts.forEach((tokenAccount) => {
            if (tokenAccount.accountInfo.mint.toString() == mintAddress) {
                found = true;
                console.log("new token checked.\n")
                return;
            }
        });

        if (!found) {
            console.log("checking new token in wallet...")
            await sleepTime(1000); // Wait for 1 seconds before retrying
        }
    }

    console.log("Creating Pool...")
    const { poolId: targetPoolPubkey, poolInfo } = await createPool({
        baseToken,
        quoteToken,
        addBaseAmount,
        addQuoteAmount,
        targetMarketId,
        startTime,
        walletTokenAccounts
    })

    // const targetPool = '9cAk6wsiehHoPyEwUJ9Vy8fpb5iHz5uCupgAMRKxVfbN' // replace pool id
    const targetPool = targetPoolPubkey.toString()

    console.log('targetPool', targetPool)

    console.log("\nExecuting Swap...")
    const swapTokenAmountTotal = addBaseAmountNumber / 100 * swapAmountInPercent;
    // const swapTokenAmountWallet = swapTokenAmountTotal / walletArray.length;
    console.log("swapTokenAmountWallet", swapTokenAmountTotal)

    const inputToken = quoteToken // WSOL
    const outputToken = baseToken // custom token

    // const outputTokenAmount = new TokenAmount(outputToken, swapTokenAmountWallet * 10 ** outputToken.decimals)
    const outputTokenAmount = new TokenAmount(outputToken, new BN(swapTokenAmountTotal).mul(new BN(10).pow(new BN(outputToken.decimals))))
    const slippage = new Percent(1, 100)

    
    
    const res = await execSwap({
        targetPool,
        inputToken,
        outputTokenAmount,
        slippage,
        wallet: process.env.PRIVATE_KEY,
    })

    // console.log("Distributing Tokens...")
    // // read wallet private keys from file
    // const walletArray = [];
    // const readInterface = readline.createInterface({
    //     input: fs.createReadStream('wallets.txt'), // Specify the path to your file here
    //     output: process.stdout,
    //     console: false
    // });

    // readInterface.on('line', function (line) {
    //     walletArray.push(line);
    // });

    // readInterface.on('close', async function () {
    //     // file read finished

    //     // const baseToken = new Token(TOKEN_PROGRAM_ID, new PublicKey("D8VCsDwkTBMTAcsBLF9UZ8vYD4U7FvcJp1fMi9n9QqhE"), tokenInfo.decimals, tokenInfo.symbol, tokenInfo.tokenName)
    //     // const quoteToken = DEFAULT_TOKEN.WSOL
    //     console.log("\nswap wallet count", walletArray.length)


    //     for (const wallet of walletArray) {
    //         const res = await execSwap({
    //             targetPool,
    //             inputToken,
    //             outputTokenAmount,
    //             slippage,
    //             wallet
    //         })
    //     }
    // });

}


