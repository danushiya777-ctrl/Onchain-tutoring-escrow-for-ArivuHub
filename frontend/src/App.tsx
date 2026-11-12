import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  SEPOLIA_CHAIN_ID,
  EXPLORER_BASE_URL,
  STATUS_MAP,
  SessionStatus,
} from './contractConfig';

interface SessionData {
  id: number;
  student: string;
  educator: string;
  amount: string;
  sessionTime: number;
  studentConfirmed: boolean;
  educatorConfirmed: boolean;
  status: SessionStatus;
}

export default function App() {
  const [account, setAccount] = useState<string>('');
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [activeTab, setActiveTab] = useState<'book' | 'my-sessions'>('book');

  // Booking Form State
  const [educatorInput, setEducatorInput] = useState<string>('');
  const [dateTimeInput, setDateTimeInput] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('0.01');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Sessions State
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [contractTimeout, setContractTimeout] = useState<number>(300);
  const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(Math.floor(Date.now() / 1000));

  // Feedback State
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');

  // Ticker for countdowns
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format Revert Errors nicely
  const parseErrorMessage = (err: any): string => {
    if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') {
      return 'Transaction rejected by user in MetaMask.';
    }
    if (err?.reason) return err.reason;
    if (err?.shortMessage) return err.shortMessage;
    if (err?.data?.message) return err.data.message;
    if (err?.message) return err.message;
    return 'An unknown transaction error occurred.';
  };

  // Get Contract instance (read or write)
  const getContract = useCallback(
    async (write: boolean = false) => {
      if (!window.ethereum) {
        throw new Error('MetaMask is not installed. Please install MetaMask to interact.');
      }
      if (
        !CONTRACT_ADDRESS ||
        CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000000'
      ) {
        throw new Error(
          'Contract address not configured! Please deploy to Sepolia and update frontend/src/contractConfig.ts'
        );
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const runner = write ? await provider.getSigner() : provider;
      return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, runner);
    },
    []
  );

  // Connect MetaMask Wallet
  const connectWallet = async () => {
    try {
      setErrorMessage('');
      if (!window.ethereum) {
        setErrorMessage('Please install MetaMask to use this application.');
        return;
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const network = await provider.getNetwork();

      setAccount(accounts[0] || '');
      setChainId(network.chainId);
    } catch (err: any) {
      setErrorMessage(parseErrorMessage(err));
    }
  };

  // Switch to Sepolia Testnet
  const switchToSepolia = async () => {
    try {
      if (!window.ethereum) return;
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }], // 11155111 in hex
      });
    } catch (err: any) {
      setErrorMessage('Could not switch network: ' + parseErrorMessage(err));
    }
  };

  // Listen to Wallet Changes
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      setAccount(accounts[0] || '');
    };

    const handleChainChanged = (hexChainId: string) => {
      setChainId(BigInt(hexChainId));
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    // Initial check
    const checkInitial = async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
          setAccount(accounts[0].address);
          const network = await provider.getNetwork();
          setChainId(network.chainId);
        }
      } catch {
        // user not connected yet
      }
    };
    checkInitial();

    return () => {
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, []);

  // Load Sessions from contract
  const loadSessions = useCallback(async () => {
    if (!account) return;
    try {
      setIsLoadingSessions(true);
      setErrorMessage('');
      const contract = await getContract(false);

      // Fetch immutable contract timeout
      try {
        const t = await contract.timeout();
        setContractTimeout(Number(t));
      } catch {
        // fallback
      }

      const totalCountBn = await contract.sessionCount();
      const total = Number(totalCountBn);
      const loaded: SessionData[] = [];

      for (let id = total; id >= 1; id--) {
        const s = await contract.sessions(id);
        const studentAddr = s.student.toLowerCase();
        const educatorAddr = s.educator.toLowerCase();
        const currentLower = account.toLowerCase();

        // Filter sessions where connected wallet is student or educator
        if (studentAddr === currentLower || educatorAddr === currentLower) {
          loaded.push({
            id,
            student: s.student,
            educator: s.educator,
            amount: ethers.formatEther(s.amount),
            sessionTime: Number(s.sessionTime),
            studentConfirmed: s.studentConfirmed,
            educatorConfirmed: s.educatorConfirmed,
            status: STATUS_MAP[Number(s.status)],
          });
        }
      }

      setSessions(loaded);
    } catch (err: any) {
      console.error(err);
      if (CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000000') {
        setErrorMessage(
          'Contract address is not set yet. Please deploy to Sepolia and update contractConfig.ts.'
        );
      } else {
        setErrorMessage(parseErrorMessage(err));
      }
    } finally {
      setIsLoadingSessions(false);
    }
  }, [account, getContract]);

  useEffect(() => {
    if (account && activeTab === 'my-sessions') {
      loadSessions();
    }
  }, [account, activeTab, loadSessions]);

  // Handle Book Session Form Submit
  const handleBookSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setTxHash('');

    if (!account) {
      setErrorMessage('Please connect your MetaMask wallet first.');
      return;
    }

    if (!ethers.isAddress(educatorInput)) {
      setErrorMessage('Invalid educator Ethereum address.');
      return;
    }

    if (educatorInput.toLowerCase() === account.toLowerCase()) {
      setErrorMessage('Educator address cannot be your own address.');
      return;
    }

    if (!dateTimeInput) {
      setErrorMessage('Please select a session date and time.');
      return;
    }

    const sessionTimestamp = Math.floor(new Date(dateTimeInput).getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);

    if (sessionTimestamp <= now) {
      setErrorMessage('Session time must be scheduled in the future.');
      return;
    }

    if (!amountInput || parseFloat(amountInput) <= 0) {
      setErrorMessage('Payment amount must be greater than 0 ETH.');
      return;
    }

    try {
      setIsSubmitting(true);
      const contract = await getContract(true);
      const depositValue = ethers.parseEther(amountInput);

      const tx = await contract.createSession(educatorInput, sessionTimestamp, {
        value: depositValue,
      });

      setTxHash(tx.hash);
      setSuccessMessage('Transaction sent! Waiting for block confirmation...');

      await tx.wait();
      setSuccessMessage('Booking successful! Funds safely locked in escrow.');
      setEducatorInput('');
      setDateTimeInput('');
      setAmountInput('0.01');
    } catch (err: any) {
      setErrorMessage(parseErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Generic Escrow Action Handler
  const executeAction = async (actionName: string, sessionId: number) => {
    try {
      setErrorMessage('');
      setSuccessMessage('');
      setTxHash('');
      const contract = await getContract(true);
      const tx = await contract[actionName](sessionId);
      setTxHash(tx.hash);
      setSuccessMessage(`Transaction sent for ${actionName}! Waiting for confirmation...`);

      await tx.wait();
      setSuccessMessage(`Successfully executed ${actionName} for session #${sessionId}!`);
      loadSessions();
    } catch (err: any) {
      setErrorMessage(parseErrorMessage(err));
    }
  };

  // Helper formatting for countdowns
  const formatCountdown = (targetTime: number) => {
    const diff = targetTime - currentTime;
    if (diff <= 0) return 'Passed';
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hours}h ${remMins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  };

  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  return (
    <div className="app-wrapper">
      {/* Top Demo Banner */}
      <div className="demo-banner">
        ⚠️ <strong>Sepolia Testnet:</strong> Runs on Sepolia test ETH. Demo only. Never use real funds or mainnet keys.
      </div>

      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🎓</span>
          <div>
            <div className="brand-title">ArivuHub Tutoring Escrow</div>
            <div className="brand-subtitle">Trustless Smart Contract Payments for Students & Educators</div>
          </div>
        </div>

        <div className="header-right">
          {chainId !== null && (
            <div className={`network-badge ${isSepolia ? 'sepolia' : 'wrong'}`}>
              <span className="pulse-dot" />
              {isSepolia ? 'Sepolia Testnet' : `Wrong Network (${chainId.toString()})`}
            </div>
          )}

          {!isSepolia && chainId !== null && (
            <button className="wallet-btn" onClick={switchToSepolia}>
              Switch to Sepolia
            </button>
          )}

          {account ? (
            <button className="wallet-btn connected" title={account}>
              👤 {account.slice(0, 6)}...{account.slice(-4)}
            </button>
          ) : (
            <button className="wallet-btn" onClick={connectWallet}>
              Connect MetaMask
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="container">
        {/* Navigation Tabs */}
        <div className="tabs">
          <button
            className={`tab-btn ${activeTab === 'book' ? 'active' : ''}`}
            onClick={() => setActiveTab('book')}
          >
            📅 Book Session (Student)
          </button>
          <button
            className={`tab-btn ${activeTab === 'my-sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('my-sessions')}
          >
            📋 My Sessions ({sessions.length})
          </button>
        </div>

        {/* Global Notifications */}
        {errorMessage && <div className="alert error">❌ {errorMessage}</div>}
        {successMessage && <div className="alert success">✅ {successMessage}</div>}
        {txHash && (
          <div className="alert warning">
            🔗 Transaction Hash:{' '}
            <a
              href={`${EXPLORER_BASE_URL}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {txHash.slice(0, 10)}...{txHash.slice(-8)} (View on Etherscan)
            </a>
          </div>
        )}

        {/* Tab 1: Book Session */}
        {activeTab === 'book' && (
          <div className="card">
            <h2 className="card-title">Book a Tutoring Session</h2>
            <p className="card-desc">
              Lock payment in the smart contract escrow. Funds are only released to the educator once
              both of you confirm the session was completed.
            </p>

            <form onSubmit={handleBookSession}>
              <div className="form-group">
                <label className="form-label">Educator Ethereum Address</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="0x..."
                  value={educatorInput}
                  onChange={(e) => setEducatorInput(e.target.value.trim())}
                  required
                />
                <div className="form-help">The verified educator who will deliver the session.</div>
              </div>

              <div className="form-group">
                <label className="form-label">Scheduled Date & Time</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={dateTimeInput}
                  onChange={(e) => setDateTimeInput(e.target.value)}
                  required
                />
                <div className="form-help">Must be a future date and time in your local timezone.</div>
              </div>

              <div className="form-group">
                <label className="form-label">Session Fee (ETH)</label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  className="form-input"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  required
                />
                <div className="form-help">Test ETH deposited into the escrow contract.</div>
              </div>

              <button
                type="submit"
                className="primary-btn"
                disabled={isSubmitting || !account}
              >
                {isSubmitting
                  ? 'Confirming Transaction...'
                  : account
                  ? 'Deposit & Book Session'
                  : 'Connect MetaMask to Book'}
              </button>
            </form>
          </div>
        )}

        {/* Tab 2: My Sessions */}
        {activeTab === 'my-sessions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Your Tutoring Escrows</h2>
              <button
                className="action-btn"
                style={{ background: '#e2e8f0', color: '#334155' }}
                onClick={loadSessions}
                disabled={isLoadingSessions}
              >
                {isLoadingSessions ? 'Refreshing...' : '🔄 Refresh'}
              </button>
            </div>

            {!account ? (
              <div className="card empty-state">
                <p>Please connect your MetaMask wallet to view your tutoring sessions.</p>
                <button className="wallet-btn" style={{ margin: '1rem auto 0' }} onClick={connectWallet}>
                  Connect MetaMask
                </button>
              </div>
            ) : sessions.length === 0 ? (
              <div className="card empty-state">
                <p>No active or completed sessions found for your wallet address ({account.slice(0, 6)}...{account.slice(-4)}).</p>
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  Switch to the "Book Session" tab to schedule your first session.
                </p>
              </div>
            ) : (
              sessions.map((session) => {
                const isStudent = session.student.toLowerCase() === account.toLowerCase();
                const isEducator = session.educator.toLowerCase() === account.toLowerCase();
                const hasSessionStarted = currentTime >= session.sessionTime;
                const timeoutThreshold = session.sessionTime + contractTimeout;
                const hasTimeoutPassed = currentTime > timeoutThreshold;

                // Action conditions according to smart contract state rules:
                // 1. Confirm: session is Funded, session has started, and caller hasn't confirmed yet
                const canConfirm =
                  session.status === 'Funded' &&
                  hasSessionStarted &&
                  ((isStudent && !session.studentConfirmed) || (isEducator && !session.educatorConfirmed));

                // 2. Claim Refund: student only, Funded, after timeout, educator did not confirm
                const canClaimRefund =
                  isStudent &&
                  session.status === 'Funded' &&
                  hasTimeoutPassed &&
                  !session.educatorConfirmed;

                // 3. Claim Payment: educator only, Funded, after timeout, educator confirmed
                const canClaimPayment =
                  isEducator &&
                  session.status === 'Funded' &&
                  hasTimeoutPassed &&
                  session.educatorConfirmed;

                // 4. Cancel: educator only, Funded, BEFORE session starts
                const canCancel =
                  isEducator &&
                  session.status === 'Funded' &&
                  !hasSessionStarted;

                return (
                  <div key={session.id} className="session-card">
                    <div className="session-header">
                      <div className="session-id">
                        Session #{session.id}{' '}
                        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                          ({isStudent ? 'Your Role: Student 🎒' : 'Your Role: Educator 🧑‍🏫'})
                        </span>
                      </div>
                      <span className={`status-badge ${session.status}`}>
                        {session.status}
                      </span>
                    </div>

                    <div className="session-grid">
                      <div className="grid-item">
                        <span className="grid-label">Amount</span>
                        <span className="grid-value">{session.amount} ETH</span>
                      </div>

                      <div className="grid-item">
                        <span className="grid-label">Scheduled Time</span>
                        <span className="grid-value">
                          {new Date(session.sessionTime * 1000).toLocaleString()}
                        </span>
                      </div>

                      <div className="grid-item">
                        <span className="grid-label">Student</span>
                        <span className="grid-value" title={session.student}>
                          {session.student.slice(0, 6)}...{session.student.slice(-4)}
                          {isStudent && ' (You)'}
                        </span>
                      </div>

                      <div className="grid-item">
                        <span className="grid-label">Educator</span>
                        <span className="grid-value" title={session.educator}>
                          {session.educator.slice(0, 6)}...{session.educator.slice(-4)}
                          {isEducator && ' (You)'}
                        </span>
                      </div>

                      <div className="grid-item">
                        <span className="grid-label">Student Confirmed</span>
                        <span className="grid-value">
                          {session.studentConfirmed ? '✅ Yes' : '⏳ Pending'}
                        </span>
                      </div>

                      <div className="grid-item">
                        <span className="grid-label">Educator Confirmed</span>
                        <span className="grid-value">
                          {session.educatorConfirmed ? '✅ Yes' : '⏳ Pending'}
                        </span>
                      </div>
                    </div>

                    {session.status === 'Funded' && (
                      <div className="countdown-box">
                        <div>
                          <strong>Session Starts In:</strong>{' '}
                          <span className="countdown-timer">{formatCountdown(session.sessionTime)}</span>
                        </div>
                        <div>
                          <strong>Timeout Window ({contractTimeout}s):</strong>{' '}
                          <span className="countdown-timer">{formatCountdown(timeoutThreshold)}</span>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons Row */}
                    {(canConfirm || canClaimRefund || canClaimPayment || canCancel) && (
                      <div className="actions-row">
                        {canConfirm && (
                          <button
                            className="action-btn confirm"
                            onClick={() => executeAction('confirmSession', session.id)}
                          >
                            ✅ Confirm Session Completed
                          </button>
                        )}

                        {canClaimRefund && (
                          <button
                            className="action-btn claim"
                            onClick={() => executeAction('claimRefund', session.id)}
                          >
                            💰 Claim Full Refund (Educator No-Show)
                          </button>
                        )}

                        {canClaimPayment && (
                          <button
                            className="action-btn claim"
                            onClick={() => executeAction('claimPayment', session.id)}
                          >
                            💵 Claim Payment (Student Silent)
                          </button>
                        )}

                        {canCancel && (
                          <button
                            className="action-btn cancel"
                            onClick={() => executeAction('cancelByEducator', session.id)}
                          >
                            🚫 Cancel Session & Refund Student
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        ArivuHub Decentralized Tutoring Escrow &bull; Sepolia Testnet Demo &bull; Built with Solidity 0.8.20 & React + Ethers.js
      </footer>
    </div>
  );
}
