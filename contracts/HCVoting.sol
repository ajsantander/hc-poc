pragma solidity ^0.5.0;

import "./SafeMath.sol";
import "./Token.sol";

contract HCVoting {
    using SafeMath for uint256;

    // Tokens.
    Token public voteToken; // Token used for actual voting.
    Token public predictToken; // Token used for predictions.

    // Vote percentages.
    // Percentages are represented as a uint256 between 0 and 10^18 (or xx * 10^16),
    // i.e. 0% = 0; 1% = 1 * 10^16; 50% = 50 * 10^16; 100% = 100 * 10^18.
    uint256 public absMajoritySupportPct; // Percentage required for a vote to pass with absolute majority, e.g. 50%.
    uint256 public constant PCT_MIN  = 50  * (10 ** 16); 
    uint256 public constant PCT_BASE = 100 * (10 ** 16); 

    // Vote times.
    uint256 absMajorityVoteTime;

    // Votes.
    enum Vote { Absent, Yea, Nay }
    struct Proposal {
        bool executed;
        uint256 startDate;
        uint256 yea;
        uint256 nay;
        mapping (address => Vote) votes;
    }
    mapping (uint256 => Proposal) internal proposals;
    uint256 public numProposals;

    // Error messages.
    string private constant ERROR_INIT_SUPPORT_TOO_SMALL   = "HCVOTING_ERROR_INIT_SUPPORT_TOO_SMALL";
    string private constant ERROR_INIT_SUPPORT_TOO_BIG     = "HCVOTING_ERROR_INIT_SUPPORT_TOO_BIG";
    string private constant ERROR_USER_HAS_NO_VOTING_POWER = "HCVOTING_ERROR_USER_HAS_NO_VOTING_POWER";
    string private constant ERROR_PROPOSAL_DOES_NOT_EXIST  = "HCVOTING_ERROR_PROPOSAL_DOES_NOT_EXIST";
    string private constant ERROR_PROPOSAL_IS_CLOSED       = "HCVOTING_ERROR_PROPOSAL_IS_CLOSED";

    // Events.
    event StartProposal(uint256 indexed proposalId, address indexed creator, string metadata);
    event CastVote(uint256 indexed voteId, address indexed voter, bool supports, uint256 stake);
  
    // Constructor (Could be replaced by an initializer).
    constructor(
        address _voteToken, 
        address _predictToken,
        uint256 _absMajoritySupportPct,
        uint256 _absMajorityVoteTime,
    ) 
        external
    {

        // Assign tokens.
        voteToken = Token(_voteToken);
        predictToken = Token(_predictToken);

        // Validate and assign percentages.
        require(_absMajoritySupportPct >= PCT_MIN, ERROR_INIT_SUPPORT_TOO_SMALL);
        require(_absMajoritySupportPct < PCT_BASE, ERROR_INIT_SUPPORT_TOO_BIG);
        absMajoritySupportPct = _absMajoritySupportPct;

        // Assign vote time.
        // TODO: Require a min absolute majority vote time?
        absMajorityVoteTime = _absMajorityVoteTime;
    }

    /*
     * External functions.
     */

    // Create a proposal.
    function createProposal(string _metadata) public returns (uint256 proposalId) {
        return _createProposal(_metadata);
    }

    // Vote on a proposal.
    // TODO: Guard on who can vote?
    function vote(uint256 _proposalId, bool _supports) public {
        require(_proposalExists(_proposalId), ERROR_PROPOSAL_DOES_NOT_EXIST);
        require(_proposalIsOpen(_proposalId), ERROR_PROPOSAL_IS_CLOSED);
        require(_userHasVotingPower(msg.sender), ERROR_USER_HAS_NO_VOTING_POWER);
        _vote(_proposalId, _supports, msg.sender);
    }

    /*
     * Internal functions.
     */

    function _createProposal(string _metadata) internal returns (uint256 proposalId) {
        proposalId = numProposals++;

        Proposal storage proposal = proposals[proposalId];
        proposal.metadata = metadata;
        proposal.startDate = now;

        emit StartProposal(proposalId, msg.sender, _metadata);
    }

    function _vote(uint256 _proposalId, bool _supports, address _voter) internal {
        Proposal storage proposal_ = proposals[_proposalId];

        // Get the user's voting power.
        uint256 votingPower = voteToken.balanceOf(_voter);

        // Has the user previously voted?
        Vote previousVote = proposal_.votes[_voter];

        // Clean up the user's previous vote, if existent.
        if(previousVote == Vote.Yea) {
            proposal_.yea = proposal_.yea.sub(votingPower);
        }
        else if(previousVote == Vote.Nay) {
            proposal_.nay = proposal_.nay.sub(votingPower);
        }

        // Update the user's vote in the proposal's yea/nay count.
        if(_supports) {
            proposal_.yea = proposal_.yea.add(votingPower);
        }
        else {
            proposal_.nay = proposal_.nay.add(votingPower);
        }

        // Update the user's vote state.
        proposal_.votes[_voter] = _supports ? Vote.Yea : Vote.Nay;

        emit CastVote(_proposalId, _voter, _supports, votingPower);
    }

    function _userHasVotingPower(address _voter) internal returns (bool) {
        return voteToken.balanceOf(_voter) > 0;
    }

    function _proposalExists(uint256 _proposalId) internal returns (bool) {
        return _proposalId < numProposals;
    }

    function _proposalIsOpen(uint256 _proposalId) internal returns (bool) {
        Proposal storage proposal_ = proposals[_proposalId];
        return !proposal_.executed && now < proposal_.startDate.add(absMajorityVoteTime);
    }

}
