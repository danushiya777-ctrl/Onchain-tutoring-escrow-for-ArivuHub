// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TutoringEscrow for ArivuHub
/// @notice A trustless escrow for online tutoring sessions on ArivuHub.
/// A student deposits payment upon booking. Payment is released to the educator only
/// after both confirm the session happened, with deterministic timeout and cancellation
/// rules so neither party can hold funds hostage.
/// @dev Implements checks-effects-interactions and OpenZeppelin ReentrancyGuard for defense-in-depth.
contract TutoringEscrow is ReentrancyGuard {
    /// @notice Lifecycle status of a tutoring session.
    /// None: Session does not exist.
    /// Funded: Payment deposited, awaiting session completion or timeout.
    /// Released: Funds paid out to the educator.
    /// Refunded: Funds returned to the student.
    enum Status {
        None,
        Funded,
        Released,
        Refunded
    }

    /// @notice Details of a booked tutoring session.
    struct Session {
        address student;
        address payable educator;
        uint256 amount;
        uint256 sessionTime;
        bool studentConfirmed;
        bool educatorConfirmed;
        Status status;
    }

    /// @notice Seconds after sessionTime before timeout escape rules can be exercised.
    /// Immutable once deployed (e.g. 100-300 seconds for demos/tests, 2 days for production).
    uint256 public immutable timeout;

    /// @notice Total number of sessions created. Also acts as unique session ID counter.
    uint256 public sessionCount;

    /// @notice Mapping from session ID to Session struct.
    mapping(uint256 => Session) public sessions;

    /// @notice Emitted when a student creates and funds a session.
    event SessionCreated(
        uint256 indexed id,
        address indexed student,
        address indexed educator,
        uint256 amount,
        uint256 sessionTime
    );

    /// @notice Emitted when a student or educator confirms that the session took place.
    event Confirmed(uint256 indexed id, address indexed by);

    /// @notice Emitted when funds are settled and transferred (either Released or Refunded).
    event Settled(
        uint256 indexed id,
        address indexed to,
        uint256 amount,
        Status status
    );

    /// @notice Initializes the contract with an immutable timeout window.
    /// @param _timeout Window in seconds after sessionTime before timeout claims become active.
    constructor(uint256 _timeout) {
        timeout = _timeout;
    }

    /// @notice Student creates a booking and deposits ETH payment into escrow.
    /// @param educator The payable address of the educator teaching the session.
    /// @param sessionTime Unix timestamp (in seconds) when the session is scheduled.
    /// @return id Unique identifier of the created session.
    function createSession(address payable educator, uint256 sessionTime)
        external
        payable
        returns (uint256 id)
    {
        require(msg.value > 0, "Payment required");
        require(educator != address(0) && educator != msg.sender, "Invalid educator");
        require(sessionTime > block.timestamp, "Session time must be in future");

        id = ++sessionCount;
        sessions[id] = Session({
            student: msg.sender,
            educator: educator,
            amount: msg.value,
            sessionTime: sessionTime,
            studentConfirmed: false,
            educatorConfirmed: false,
            status: Status.Funded
        });

        emit SessionCreated(id, msg.sender, educator, msg.value, sessionTime);
    }

    /// @notice Student or educator confirms that the session was completed.
    /// When both parties have confirmed, escrow funds are automatically paid to the educator.
    /// @param id The ID of the session to confirm.
    function confirmSession(uint256 id) external nonReentrant {
        Session storage s = sessions[id];
        require(s.status == Status.Funded, "Session not active");
        require(block.timestamp >= s.sessionTime, "Session not started yet");

        if (msg.sender == s.student) {
            s.studentConfirmed = true;
        } else if (msg.sender == s.educator) {
            s.educatorConfirmed = true;
        } else {
            revert("Not a participant");
        }

        emit Confirmed(id, msg.sender);

        if (s.studentConfirmed && s.educatorConfirmed) {
            _settle(id, s.educator, Status.Released);
        }
    }

    /// @notice Student claims a full refund if the educator never confirmed (educator no-show)
    /// after the timeout window has passed.
    /// @param id The ID of the session to refund.
    function claimRefund(uint256 id) external nonReentrant {
        Session storage s = sessions[id];
        require(msg.sender == s.student, "Only student");
        require(s.status == Status.Funded, "Session not active");
        require(block.timestamp > s.sessionTime + timeout, "Timeout not reached");
        require(!s.educatorConfirmed, "Educator confirmed");

        _settle(id, payable(s.student), Status.Refunded);
    }

    /// @notice Educator claims payment if they confirmed session completion but the student
    /// failed to confirm (student stalling/silent) after the timeout window has passed.
    /// @param id The ID of the session to claim.
    function claimPayment(uint256 id) external nonReentrant {
        Session storage s = sessions[id];
        require(msg.sender == s.educator, "Only educator");
        require(s.status == Status.Funded, "Session not active");
        require(block.timestamp > s.sessionTime + timeout, "Timeout not reached");
        require(s.educatorConfirmed, "Educator has not confirmed");

        _settle(id, s.educator, Status.Released);
    }

    /// @notice Educator cancels the session before it starts; student receives full refund.
    /// @param id The ID of the session to cancel.
    function cancelByEducator(uint256 id) external nonReentrant {
        Session storage s = sessions[id];
        require(msg.sender == s.educator, "Only educator");
        require(s.status == Status.Funded, "Session not active");
        require(block.timestamp < s.sessionTime, "Session already started");

        _settle(id, payable(s.student), Status.Refunded);
    }

    /// @dev Internal settlement helper.
    /// Follows the Checks-Effects-Interactions pattern: status is updated BEFORE sending ETH.
    /// OpenZeppelin ReentrancyGuard (nonReentrant modifier on calling external functions) adds
    /// defense-in-depth against reentrancy.
    /// Tradeoff note: nonReentrant incurs a minor gas overhead (~2,100 to 2,900 gas for SSTORE/SLOAD)
    /// but guarantees complete protection if future functions or callback logic are introduced.
    /// @param id The session ID being settled.
    /// @param to Recipient address (either educator or student).
    /// @param newStatus Final state (Status.Released or Status.Refunded).
    function _settle(uint256 id, address payable to, Status newStatus) internal {
        Session storage s = sessions[id];
        s.status = newStatus;
        uint256 amt = s.amount;

        (bool ok, ) = to.call{value: amt}("");
        require(ok, "Transfer failed");

        emit Settled(id, to, amt, newStatus);
    }
}

