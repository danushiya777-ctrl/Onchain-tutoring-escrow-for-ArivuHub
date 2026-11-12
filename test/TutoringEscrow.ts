import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { TutoringEscrow } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("TutoringEscrow for ArivuHub", function () {
  const TIMEOUT = 100; // 100 seconds timeout for fast testing
  const DEPOSIT_AMOUNT = ethers.parseEther("0.01");

  let escrow: TutoringEscrow;
  let student: HardhatEthersSigner;
  let educator: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  // Status enum mapping
  enum Status {
    None = 0,
    Funded = 1,
    Released = 2,
    Refunded = 3,
  }

  beforeEach(async function () {
    [student, educator, stranger] = await ethers.getSigners();
    const TutoringEscrowFactory = await ethers.getContractFactory("TutoringEscrow");
    escrow = await TutoringEscrowFactory.deploy(TIMEOUT);
    await escrow.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct immutable timeout", async function () {
      expect(await escrow.timeout()).to.equal(TIMEOUT);
    });

    it("should initialize sessionCount to zero", async function () {
      expect(await escrow.sessionCount()).to.equal(0);
    });
  });

  describe("Session Creation (createSession)", function () {
    it("1. should revert if msg.value is 0", async function () {
      const now = await time.latest();
      await expect(
        escrow.connect(student).createSession(educator.address, now + 3600, {
          value: 0,
        })
      ).to.be.revertedWith("Payment required");
    });

    it("2. should revert if educator is student's own address", async function () {
      const now = await time.latest();
      await expect(
        escrow.connect(student).createSession(student.address, now + 3600, {
          value: DEPOSIT_AMOUNT,
        })
      ).to.be.revertedWith("Invalid educator");
    });

    it("should revert if educator is address(0)", async function () {
      const now = await time.latest();
      await expect(
        escrow.connect(student).createSession(ethers.ZeroAddress, now + 3600, {
          value: DEPOSIT_AMOUNT,
        })
      ).to.be.revertedWith("Invalid educator");
    });

    it("3. should revert if sessionTime is in the past or present", async function () {
      const now = await time.latest();
      await expect(
        escrow.connect(student).createSession(educator.address, now - 10, {
          value: DEPOSIT_AMOUNT,
        })
      ).to.be.revertedWith("Session time must be in future");
    });

    it("4. should successfully create a session, lock funds, and emit SessionCreated", async function () {
      const now = await time.latest();
      const sessionTime = now + 500;

      await expect(
        escrow.connect(student).createSession(educator.address, sessionTime, {
          value: DEPOSIT_AMOUNT,
        })
      )
        .to.emit(escrow, "SessionCreated")
        .withArgs(1, student.address, educator.address, DEPOSIT_AMOUNT, sessionTime);

      expect(await escrow.sessionCount()).to.equal(1);

      // Verify contract holds exact deposit amount
      const contractBalance = await ethers.provider.getBalance(await escrow.getAddress());
      expect(contractBalance).to.equal(DEPOSIT_AMOUNT);

      // Verify stored session data
      const session = await escrow.sessions(1);
      expect(session.student).to.equal(student.address);
      expect(session.educator).to.equal(educator.address);
      expect(session.amount).to.equal(DEPOSIT_AMOUNT);
      expect(session.sessionTime).to.equal(sessionTime);
      expect(session.studentConfirmed).to.be.false;
      expect(session.educatorConfirmed).to.be.false;
      expect(session.status).to.equal(Status.Funded);
    });
  });

  describe("Confirmations & Payout (Happy Path)", function () {
    let sessionTime: number;

    beforeEach(async function () {
      const now = await time.latest();
      sessionTime = now + 500;
      await escrow.connect(student).createSession(educator.address, sessionTime, {
        value: DEPOSIT_AMOUNT,
      });
    });

    it("5. should revert if confirming before session time", async function () {
      await expect(escrow.connect(student).confirmSession(1)).to.be.revertedWith(
        "Session not started yet"
      );
      await expect(escrow.connect(educator).confirmSession(1)).to.be.revertedWith(
        "Session not started yet"
      );
    });

    it("6. should revert if a stranger tries to confirm", async function () {
      await time.increaseTo(sessionTime);
      await expect(escrow.connect(stranger).confirmSession(1)).to.be.revertedWith(
        "Not a participant"
      );
    });

    it("7. should record student confirmation after session time without early payout", async function () {
      await time.increaseTo(sessionTime);

      await expect(escrow.connect(student).confirmSession(1))
        .to.emit(escrow, "Confirmed")
        .withArgs(1, student.address);

      const s = await escrow.sessions(1);
      expect(s.studentConfirmed).to.be.true;
      expect(s.educatorConfirmed).to.be.false;
      expect(s.status).to.equal(Status.Funded);

      // Funds still in escrow
      const contractBalance = await ethers.provider.getBalance(await escrow.getAddress());
      expect(contractBalance).to.equal(DEPOSIT_AMOUNT);
    });

    it("8. should release payment to educator when both confirm (checking balance change and event)", async function () {
      await time.increaseTo(sessionTime);

      // Student confirms first
      await escrow.connect(student).confirmSession(1);

      // Educator confirms second -> triggers settlement
      await expect(escrow.connect(educator).confirmSession(1))
        .to.emit(escrow, "Settled")
        .withArgs(1, educator.address, DEPOSIT_AMOUNT, Status.Released);

      const s = await escrow.sessions(1);
      expect(s.status).to.equal(Status.Released);

      // Contract balance is zero after settlement
      const contractBal = await ethers.provider.getBalance(await escrow.getAddress());
      expect(contractBal).to.equal(0);
    });

    it("should verify exact educator balance increase on settlement", async function () {
      await time.increaseTo(sessionTime);
      await escrow.connect(student).confirmSession(1);

      await expect(escrow.connect(educator).confirmSession(1))
        .to.changeEtherBalance(educator, DEPOSIT_AMOUNT);
    });

    it("should release payment to educator if educator confirms first, then student confirms", async function () {
      await time.increaseTo(sessionTime);

      // Educator confirms first
      await escrow.connect(educator).confirmSession(1);

      // Student confirms second
      await expect(escrow.connect(student).confirmSession(1))
        .to.changeEtherBalance(educator, DEPOSIT_AMOUNT);

      const s = await escrow.sessions(1);
      expect(s.status).to.equal(Status.Released);
    });

    it("9. should revert if anyone tries to confirm again after session is settled", async function () {
      await time.increaseTo(sessionTime);
      await escrow.connect(student).confirmSession(1);
      await escrow.connect(educator).confirmSession(1);

      await expect(escrow.connect(student).confirmSession(1)).to.be.revertedWith(
        "Session not active"
      );
      await expect(escrow.connect(educator).confirmSession(1)).to.be.revertedWith(
        "Session not active"
      );
    });
  });

  describe("Timeout & Refunds (claimRefund & claimPayment)", function () {
    let sessionTime: number;

    beforeEach(async function () {
      const now = await time.latest();
      sessionTime = now + 500;
      await escrow.connect(student).createSession(educator.address, sessionTime, {
        value: DEPOSIT_AMOUNT,
      });
    });

    it("10. should revert if student claims refund before timeout has passed", async function () {
      await time.increaseTo(sessionTime + 10); // past sessionTime, but within timeout window
      await expect(escrow.connect(student).claimRefund(1)).to.be.revertedWith(
        "Timeout not reached"
      );
    });

    it("11. should refund student after timeout if educator never confirmed (no-show)", async function () {
      // Warp to after sessionTime + TIMEOUT
      await time.increaseTo(sessionTime + TIMEOUT + 1);

      await expect(escrow.connect(student).claimRefund(1))
        .to.changeEtherBalance(student, DEPOSIT_AMOUNT);

      const s = await escrow.sessions(1);
      expect(s.status).to.equal(Status.Refunded);

      // Contract balance is zero
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    });

    it("12. should revert if student claims refund after timeout when educator DID confirm", async function () {
      await time.increaseTo(sessionTime);
      await escrow.connect(educator).confirmSession(1);

      // Advance past timeout
      await time.increaseTo(sessionTime + TIMEOUT + 1);

      await expect(escrow.connect(student).claimRefund(1)).to.be.revertedWith(
        "Educator confirmed"
      );
    });

    it("13. should pay educator via claimPayment after timeout if educator confirmed but student stalled", async function () {
      await time.increaseTo(sessionTime);
      await escrow.connect(educator).confirmSession(1);

      // Student stays silent, advance past timeout
      await time.increaseTo(sessionTime + TIMEOUT + 1);

      await expect(escrow.connect(educator).claimPayment(1))
        .to.changeEtherBalance(educator, DEPOSIT_AMOUNT);

      const s = await escrow.sessions(1);
      expect(s.status).to.equal(Status.Released);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    });

    it("should revert if educator calls claimPayment before timeout has passed", async function () {
      await time.increaseTo(sessionTime);
      await escrow.connect(educator).confirmSession(1);

      await expect(escrow.connect(educator).claimPayment(1)).to.be.revertedWith(
        "Timeout not reached"
      );
    });

    it("should revert if educator calls claimPayment when educator has NOT confirmed", async function () {
      await time.increaseTo(sessionTime + TIMEOUT + 1);
      await expect(escrow.connect(educator).claimPayment(1)).to.be.revertedWith(
        "Educator has not confirmed"
      );
    });

    it("16. should enforce role restrictions on claimRefund and claimPayment", async function () {
      await time.increaseTo(sessionTime + TIMEOUT + 1);

      // Non-student calls claimRefund
      await expect(escrow.connect(educator).claimRefund(1)).to.be.revertedWith(
        "Only student"
      );
      await expect(escrow.connect(stranger).claimRefund(1)).to.be.revertedWith(
        "Only student"
      );

      // Non-educator calls claimPayment
      await expect(escrow.connect(student).claimPayment(1)).to.be.revertedWith(
        "Only educator"
      );
      await expect(escrow.connect(stranger).claimPayment(1)).to.be.revertedWith(
        "Only educator"
      );
    });
  });

  describe("Educator Cancellation (cancelByEducator)", function () {
    let sessionTime: number;

    beforeEach(async function () {
      const now = await time.latest();
      sessionTime = now + 500;
      await escrow.connect(student).createSession(educator.address, sessionTime, {
        value: DEPOSIT_AMOUNT,
      });
    });

    it("14. should allow educator to cancel before session time and refund student", async function () {
      await expect(escrow.connect(educator).cancelByEducator(1))
        .to.changeEtherBalance(student, DEPOSIT_AMOUNT);

      const s = await escrow.sessions(1);
      expect(s.status).to.equal(Status.Refunded);

      // Contract balance is zero
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    });

    it("15. should revert if educator tries to cancel after session time has started", async function () {
      await time.increaseTo(sessionTime + 1);
      await expect(escrow.connect(educator).cancelByEducator(1)).to.be.revertedWith(
        "Session already started"
      );
    });

    it("should revert if non-educator tries to call cancelByEducator", async function () {
      await expect(escrow.connect(student).cancelByEducator(1)).to.be.revertedWith(
        "Only educator"
      );
      await expect(escrow.connect(stranger).cancelByEducator(1)).to.be.revertedWith(
        "Only educator"
      );
    });

    it("should revert if cancelByEducator is called on an already settled session", async function () {
      await escrow.connect(educator).cancelByEducator(1);
      await expect(escrow.connect(educator).cancelByEducator(1)).to.be.revertedWith(
        "Session not active"
      );
    });
  });
});
