pragma solidity ^0.5.0;

import "./HCStaking.sol";

contract HCCompensations is HCStaking {

    /*
     * External functions.
     */

    // TODO: Remove!
    event LogTime(uint256 _now, uint256 _targetTime);
    
    function resolveBoostedProposal(uint256 _proposalId) public {
        require(_proposalExists(_proposalId), ERROR_PROPOSAL_DOES_NOT_EXIST);
        require(_proposalStateIs(_proposalId, ProposalState.Boosted), ERROR_PROPOSAL_IS_NOT_BOOSTED);

        // Verify that the proposal lifetime has ended.
        Proposal storage proposal_ = proposals[_proposalId];
        emit LogTime(now, proposal_.startDate.add(proposal_.lifetime));
        // require(now >= proposal_.startDate.add(proposal_.lifetime), ERROR_PROPOSAL_IS_ACTIVE);

        // Compensate the caller.
        // uint256 fee = _calculateCompensationFee(_proposalId, proposal_.startDate.add(proposal_.lifetime));
        // require(stakeToken.balanceOf(address(this)) >= fee, ERROR_VOTING_DOES_NOT_HAVE_ENOUGH_FUNDS);
        // stakeToken.transfer(msg.sender, fee);

        // Resolve the proposal.
        // _updateProposalState(_proposalId, ProposalState.Resolved);
    }

    function expireNonBoostedProposal(uint256 _proposalId) public {
        require(_proposalExists(_proposalId), ERROR_PROPOSAL_DOES_NOT_EXIST);
        require(_proposalStateIs(_proposalId, ProposalState.Expired), ERROR_PROPOSAL_IS_CLOSED);
        require(!_proposalStateIs(_proposalId, ProposalState.Boosted), ERROR_PROPOSAL_IS_BOOSTED);

        // Verify that the proposal's lifetime has ended.
        Proposal storage proposal_ = proposals[_proposalId];
        require(now >= proposal_.startDate.add(proposal_.lifetime), ERROR_PROPOSAL_IS_ACTIVE);

        // Compensate the caller.
        uint256 fee = _calculateCompensationFee(_proposalId, proposal_.startDate.add(proposal_.lifetime));
        require(stakeToken.balanceOf(address(this)) >= fee, ERROR_VOTING_DOES_NOT_HAVE_ENOUGH_FUNDS);
        stakeToken.transfer(msg.sender, fee);

        // Update the proposal's state and emit an event.
        _updateProposalState(_proposalId, ProposalState.Expired);
    }

    function boostProposal(uint256 _proposalId) public {
        require(_proposalExists(_proposalId), ERROR_PROPOSAL_DOES_NOT_EXIST);
        // TODO: Different errors for these
        require(!_proposalStateIs(_proposalId, ProposalState.Expired), ERROR_PROPOSAL_IS_CLOSED);
        require(!_proposalStateIs(_proposalId, ProposalState.Resolved), ERROR_PROPOSAL_IS_CLOSED);
        require(!_proposalStateIs(_proposalId, ProposalState.Boosted), ERROR_PROPOSAL_IS_BOOSTED);

        // Require that the proposal is currently pended.
        Proposal storage proposal_ = proposals[_proposalId];
        require(proposal_.state == ProposalState.Pended);

        // Require that the proposal has had enough confidence for a period of time.
        require(_proposalHasEnoughConfidence(proposal_), ERROR_PROPOSAL_DOESNT_HAVE_ENOUGH_CONFIDENCE);
        require(now >= proposal_.lastPendedDate.add(pendedBoostPeriod), ERROR_PROPOSAL_HASNT_HAD_CONFIDENCE_ENOUGH_TIME);

        // Compensate the caller.
        uint256 fee = _calculateCompensationFee(_proposalId, proposal_.lastPendedDate.add(pendedBoostPeriod));
        require(stakeToken.balanceOf(address(this)) >= fee, ERROR_VOTING_DOES_NOT_HAVE_ENOUGH_FUNDS);
        stakeToken.transfer(msg.sender, fee);

        // Boost the proposal.
        _updateProposalState(_proposalId, ProposalState.Boosted);
        proposal_.lifetime = boostPeriod;
        proposal_.lastPendedDate = 0;
    }

    /*
     * Utility functions.
     */

    function _calculateCompensationFee(uint256 _proposalId, uint256 _cutoffDate) internal view returns(uint256 _fee) {

        // Require that the proposal has potentially expired.
        // This is necessary because the fee depends on the time since expiration.
        // If the proposal hasn't expired, the calculation would yield a negative fee.
        Proposal storage proposal_ = proposals[_proposalId];
        require(now >= _cutoffDate, ERROR_INVALID_COMPENSATION_FEE);

        // Calculate fee.
        uint256 timeSinceExpiration = now.sub(_cutoffDate);
        uint256 upstakePortion = proposal_.upstake.mul(PRECISION_MULTIPLIER) / compensationFeePct;
        _fee = timeSinceExpiration.mul(PRECISION_MULTIPLIER) / upstakePortion;

        // Cap the fee to a maximum of compensationFeePct * total upstake.
        if(_fee.mul(PRECISION_MULTIPLIER) > upstakePortion) {
            _fee = upstakePortion / PRECISION_MULTIPLIER;
        }
    }
}
