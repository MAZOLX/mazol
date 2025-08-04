require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const cron = require('node-cron');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIGURATION ===== //
const BNB_RPC_URL = process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org/';
const MZLX_ADDRESS = process.env.MZLX_ADDRESS || '0x49F4a728BD98480E92dBfc6a82d595DA9d1F7b83';
const USDT_ADDRESS = process.env.USDT_ADDRESS || '0x55d398326f99059fF775485246999027B3197955';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

// Validate private key
if (!ADMIN_PRIVATE_KEY || !/^[0-9a-fA-F]{64}$/.test(ADMIN_PRIVATE_KEY)) {
  console.error('ERROR: Invalid private key format - must be 64 hex characters');
  process.exit(1);
}

// Setup
const provider = new ethers.JsonRpcProvider(BNB_RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

// ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const mzlxContract = new ethers.Contract(MZLX_ADDRESS, ERC20_ABI, adminWallet);
const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== ROUTES ===== //

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const balance = await mzlxContract.balanceOf(adminWallet.address);
    const decimals = await mzlxContract.decimals();
    const formattedBalance = ethers.formatUnits(balance, decimals);
    
    res.json({ 
      status: 'active',
      chainId: 56,
      adminWallet: adminWallet.address,
      mzlxBalance: formattedBalance,
      network: 'BNB Smart Chain',
      lastChecked: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch balance',
      details: error.message 
    });
  }
});

// Purchase Endpoint
app.post('/api/purchase', async (req, res) => {
  try {
    const { walletAddress, usdtAmount, mzlxAmount, txHash } = req.body;

    // Validate input
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (isNaN(usdtAmount) || usdtAmount <= 0) {
      return res.status(400).json({ error: 'Invalid USDT amount' });
    }
    if (!txHash || !/^0x([A-Fa-f0-9]{64})$/.test(txHash)) {
      return res.status(400).json({ error: 'Invalid transaction hash' });
    }

    // Verify transaction
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction failed on-chain' });
    }

    // Check if transaction was to our receiver address
    const receiverAddress = process.env.RECEIVER_ADDRESS || adminWallet.address;
    if (tx.to.toLowerCase() !== USDT_ADDRESS.toLowerCase()) {
      return res.status(400).json({ error: 'Not a USDT transaction' });
    }

    // Parse logs to verify transfer to our address
    const iface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);
    
    let transferFound = false;
    for (const log of receipt.logs) {
      try {
        const parsedLog = iface.parseLog(log);
        if (parsedLog && parsedLog.name === "Transfer") {
          const [from, to, value] = parsedLog.args;
          if (to.toLowerCase() === receiverAddress.toLowerCase()) {
            transferFound = true;
            break;
          }
        }
      } catch (e) {
        // Skip logs that can't be parsed
      }
    }
    
    if (!transferFound) {
      return res.status(400).json({ error: 'No transfer to receiver found' });
    }

    // Convert amount to bigint
    const mzlxValue = ethers.parseUnits(mzlxAmount.toString(), await mzlxContract.decimals());
    
    // Check admin balance
    const adminBalance = await mzlxContract.balanceOf(adminWallet.address);
    if (adminBalance < mzlxValue) {
      return res.status(400).json({ 
        error: 'Insufficient MZLx tokens in reserve',
        available: ethers.formatUnits(adminBalance, await mzlxContract.decimals()),
        required: mzlxAmount
      });
    }

    // Send MZLx tokens
    const sendTx = await mzlxContract.transfer(walletAddress, mzlxValue);
    const sendReceipt = await sendTx.wait();
    
    if (sendReceipt.status !== 1) {
      return res.status(500).json({ error: 'Failed to send MZLx tokens' });
    }

    res.json({
      success: true,
      message: 'MZLx tokens sent successfully',
      mzlxTxHash: sendTx.hash,
      mzlxAmount: mzlxAmount,
      usdtAmount: usdtAmount,
      receiver: walletAddress,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: error.reason || undefined
    });
  }
});

// Keep-alive function
function pingServer() {
  http.get(`http://localhost:${PORT}/api/health`, (res) => {
    console.log(`[${new Date().toISOString()}] Health check: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error(`Health check error: ${err.message}`);
  });
}

// ===== START SERVER ===== //
app.listen(PORT, () => {
  console.log(`\n🚀 MAZOL Token Sale Backend running on port ${PORT}`);
  console.log(`🔐 Admin Wallet: ${adminWallet.address}`);
  console.log(`🔗 RPC Provider: ${BNB_RPC_URL}`);
  console.log(`💎 MZLX Contract: ${MZLX_ADDRESS}`);
  console.log(`💵 USDT Contract: ${USDT_ADDRESS}\n`);
  
  // Schedule keep-alive pings (every 5 minutes)
  cron.schedule('*/5 * * * *', () => {
    console.log(`[${new Date().toISOString()}] Running keep-alive`);
    pingServer();
  });
  
  // Initial ping
  pingServer();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Server shutting down...');
  process.exit(0);
});
