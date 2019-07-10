const getWeb3 = require('../scripts/getWeb3.js');
const deploy = require('../scripts/deploy.js');
const util = require('../scripts/util.js');
const reverts = require('../scripts/reverts.js');

describe('HolographicConsensus', () => {
    
    let web3;
    let accounts;
    let txParams;

    beforeAll(async () => {
        web3 = getWeb3('localhost');
        accounts = await web3.eth.getAccounts();
        txParams = {
          from: accounts[0],
          gas: 6700000,
          gasPrice: 1
        };
    });

    describe('When setting up an HC contract correctly', () => {

        let voteTokenContract;
        let stakeTokenContract;
        let votingContract;

        const HOURS = 60 * 60;
        const SUPPORT_PERCENT = 51;
        const QUEUE_PERIOD_SECS = 24 * HOURS;
        const BOOST_PERIOD_SECS = 6 * HOURS;
        const BOOST_PERIOD_EXTENSION_SECS = 0.25 * HOURS;
        const PENDED_BOOST_PERIOD_SECS = 1 * HOURS;
        const COMPENSATION_FEE_PERCENT = 10;
        const CONFIDENCE_THRESHOLD_BASE = 4;
        const PRECISION_MULTIPLIER = 10 ** 16;

        beforeEach(async () => {

            // Deploy voting and staking Token contracts.
            voteTokenContract = await deploy('Token', [], txParams);
            stakeTokenContract = await deploy('Token', [], txParams);

            // Deploy and initialize Voting contract.
            votingContract = await deploy('HolographicConsensus', [], txParams);
            await votingContract.methods.initializeVoting(
                voteTokenContract.options.address,
                SUPPORT_PERCENT,
                QUEUE_PERIOD_SECS,
                BOOST_PERIOD_SECS,
                BOOST_PERIOD_EXTENSION_SECS,
                COMPENSATION_FEE_PERCENT
            ).send({ ...txParams });
            await votingContract.methods.initializeStaking(
                stakeTokenContract.options.address,
                PENDED_BOOST_PERIOD_SECS,
                CONFIDENCE_THRESHOLD_BASE
            ).send({ ...txParams });
        });

        test('Tokens get deployed correctly', async () => {
            expect(web3.utils.isAddress(voteTokenContract.options.address)).toBe(true);
            expect(web3.utils.isAddress(stakeTokenContract.options.address)).toBe(true);
        });

        test('Voting gets deployed and set up correctly', async () => {
            expect(web3.utils.isAddress(votingContract.options.address)).toBe(true);
            expect(await votingContract.methods.supportPct().call()).toBe(`${SUPPORT_PERCENT}`);
            expect(await votingContract.methods.queuePeriod().call()).toBe(`${QUEUE_PERIOD_SECS}`);
            expect(await votingContract.methods.boostPeriod().call()).toBe(`${BOOST_PERIOD_SECS}`);
            expect(await votingContract.methods.boostPeriodExtension().call()).toBe(`${BOOST_PERIOD_EXTENSION_SECS}`);
            expect(await votingContract.methods.pendedBoostPeriod().call()).toBe(`${PENDED_BOOST_PERIOD_SECS}`);
            expect(await votingContract.methods.compensationFeePct().call()).toBe(`${COMPENSATION_FEE_PERCENT}`);
        });

        describe('When creating proposals', () => {

            const proposalCreationReceipts = [];

            const NUM_PROPOSALS = 8;
            
            beforeEach(async () => {

                // Create a few proposals.
                for(let i = 0; i < NUM_PROPOSALS; i++) {
                    const receipt = await votingContract.methods.createProposal(
                        `DAOs should rule the world ${i}`
                    ).send({ ...txParams });
                    proposalCreationReceipts.push(receipt);
                }
            });

            test('numProposals should increase', async () => {
                expect(await votingContract.methods.numProposals().call()).toBe(`${NUM_PROPOSALS}`);
            });

            test('Emit ProposalCreated events', async () => {
                const receipt = proposalCreationReceipts[2];
                const event = receipt.events.ProposalCreated;
                expect(event).not.toBeNull();
                expect(event.returnValues._proposalId).toBe(`2`);
                expect(event.returnValues._creator).toBe(accounts[0]);
                expect(event.returnValues._metadata).toBe(`DAOs should rule the world 2`);
            });

            test('The proposal should be created with expected parameters', async () => {
                const proposal = await votingContract.methods.getProposal(2).call();
                expect(proposal.id).toBe(`2`);
                expect(proposal.state).toBe(`0`);
                expect(proposal.yea).toBe(`0`);
                expect(proposal.nay).toBe(`0`);
                expect(proposal.upstake).toBe(`0`);
                expect(proposal.downstake).toBe(`0`);
                const startDateDeltaSecs = ( new Date().getTime() / 1000 ) - parseInt(proposal.startDate, 10);
                expect(startDateDeltaSecs).toBeLessThan(2);
                expect(proposal.lifetime).toBe(`${QUEUE_PERIOD_SECS}`);
            });

            describe('When voting on proposals (that have no stake)', () => {
                
                beforeEach(async () => {

                    // Mint some vote tokens.
                    await voteTokenContract.methods.mint(accounts[0], 1  ).send({ ...txParams });
                    await voteTokenContract.methods.mint(accounts[1], 1  ).send({ ...txParams });
                    await voteTokenContract.methods.mint(accounts[2], 1  ).send({ ...txParams });
                    await voteTokenContract.methods.mint(accounts[3], 10 ).send({ ...txParams });
                    await voteTokenContract.methods.mint(accounts[4], 10 ).send({ ...txParams });
                    await voteTokenContract.methods.mint(accounts[5], 10 ).send({ ...txParams });
                    await voteTokenContract.methods.mint(accounts[6], 100).send({ ...txParams });
                    await voteTokenContract.methods.mint(accounts[7], 100).send({ ...txParams });
                    await voteTokenContract.methods.mint(accounts[8], 100).send({ ...txParams });
                    // Note: No tokens for account 9 =(
                    // Note: Vote token total supply should be 333.
                });

                test('Should reject voting on proposals that do not exist', async () => {
                    expect(await reverts(
                        votingContract.methods.vote(9, true).send({ ...txParams }),
                        `VOTING_ERROR_PROPOSAL_DOES_NOT_EXIST`
                    )).toBe(true);
                });

                test('Should reject voting from accounts that do not own vote tokens', async () => {
                    expect(await reverts(
                        votingContract.methods.vote(0, true).send({ ...txParams, from: accounts[9] }),
                        `VOTING_ERROR_USER_HAS_NO_VOTING_POWER`
                    )).toBe(true);
                });

                test('Should allow multiple votes on a proposal, tracking support and emitting events', async () => {

                    // Cast some random votes.
                    await votingContract.methods.vote(1, true).send({ ...txParams, from: accounts[0] });
                    await votingContract.methods.vote(1, true).send({ ...txParams, from: accounts[3] });
                    const receipt = await votingContract.methods.vote(1, false).send({ ...txParams, from: accounts[6] });
                    
                    // Verify that at least one VoteCasted event was emitted.
                    const event = receipt.events.VoteCasted;
                    expect(event).not.toBeNull();
                    expect(event.returnValues._proposalId).toBe(`1`);
                    expect(event.returnValues._voter).toBe(accounts[6]);
                    expect(event.returnValues._supports).toBe(false);
                    expect(event.returnValues._stake).toBe(`100`);
                    
                    // Retrieve the proposal and verify that the votes were recoreded.
                    let proposal = await votingContract.methods.getProposal(1).call();
                    expect(proposal.yea).toBe(`11`);
                    expect(proposal.nay).toBe(`100`);

                    // Verify that each voter's vote state is coherent with the vote.
                    expect(await votingContract.methods.getVote(1, accounts[0]).call()).toBe(`1`);
                    expect(await votingContract.methods.getVote(1, accounts[3]).call()).toBe(`1`);
                    expect(await votingContract.methods.getVote(1, accounts[6]).call()).toBe(`2`);

                    // Verify that someone that hasn't voted registers no vote.
                    expect(await votingContract.methods.getVote(1, accounts[8]).call()).toBe(`0`);

                    // Change some votes.
                    await votingContract.methods.vote(1, false).send({ ...txParams, from: accounts[0] });
                    await votingContract.methods.vote(1, true).send({ ...txParams, from: accounts[3] });
                    await votingContract.methods.vote(1, false).send({ ...txParams, from: accounts[6] });

                    // Retrieve the proposal and verify that the votes were recoreded.
                    proposal = await votingContract.methods.getProposal(1).call();
                    expect(proposal.yea).toBe(`10`);
                    expect(proposal.nay).toBe(`101`);

                    // Verify that each voter's vote state is coherent with the vote.
                    expect(await votingContract.methods.getVote(1, accounts[0]).call()).toBe(`2`);
                    expect(await votingContract.methods.getVote(1, accounts[3]).call()).toBe(`1`);
                    expect(await votingContract.methods.getVote(1, accounts[6]).call()).toBe(`2`);
                });

                test('Should automatically resolve a proposal once it reaches absolute majority support, emitting events', async () => {
                    
                    // Cast some random votes.
                    await votingContract.methods.vote(0, false).send({ ...txParams, from: accounts[0] });
                    await votingContract.methods.vote(0, false).send({ ...txParams, from: accounts[1] });
                    await votingContract.methods.vote(0, false).send({ ...txParams, from: accounts[4] });
                    await votingContract.methods.vote(0, true).send({ ...txParams, from: accounts[7] });
                    const receipt = await votingContract.methods.vote(0, true).send({ ...txParams, from: accounts[8] });

                    // Check that a ProposalStateChanged event was emitted.
                    const event = receipt.events.ProposalStateChanged;
                    expect(event).not.toBeNull();
                    expect(event.returnValues._proposalId).toBe(`0`);
                    expect(event.returnValues._newState).toBe(`4`); // ProposalState '4' = Resolved
                    
                    // Retrieve the proposal and verify that it has been resolved.
                    const proposal = await votingContract.methods.getProposal(0).call();
                    expect(proposal.state).toBe(`4`); // ProposalState '4' = Resolved
                });

                test('Should not resolve a proposal while it doesn\'t reach absolute majority', async () => {
                    
                    // Cast some random votes.
                    await votingContract.methods.vote(3, false).send({ ...txParams, from: accounts[0] });
                    await votingContract.methods.vote(3, false).send({ ...txParams, from: accounts[1] });
                    await votingContract.methods.vote(3, false).send({ ...txParams, from: accounts[4] });
                    await votingContract.methods.vote(3, true).send({ ...txParams, from: accounts[8] });

                    // Retrieve the proposal and verify that it has been resolved.
                    const proposal = await votingContract.methods.getProposal(3).call();
                    expect(proposal.state).toBe(`0`); // ProposalState '0' = Queued
                });

                describe('When staking on proposals', () => {

                    beforeEach(async () => {
                        
                        // Mint some stake tokens.
                        await stakeTokenContract.methods.mint(accounts[0], 1  ).send({ ...txParams });
                        await stakeTokenContract.methods.mint(accounts[1], 1  ).send({ ...txParams });
                        await stakeTokenContract.methods.mint(accounts[2], 1  ).send({ ...txParams });
                        await stakeTokenContract.methods.mint(accounts[3], 10 ).send({ ...txParams });
                        await stakeTokenContract.methods.mint(accounts[4], 10 ).send({ ...txParams });
                        await stakeTokenContract.methods.mint(accounts[5], 10 ).send({ ...txParams });
                        await stakeTokenContract.methods.mint(accounts[6], 100).send({ ...txParams });
                        await stakeTokenContract.methods.mint(accounts[7], 100).send({ ...txParams });
                        await stakeTokenContract.methods.mint(accounts[8], 100).send({ ...txParams });
                        // Note: No tokens for account 9 =(
                        // Note: Stake token total supply should be 333.

                        // All stakers give 'infinite' allowance to the contract.
                        // Note: In practice, a staker will need to either atomically provide allowance
                        // to the voting contract, or provide it by chunks that would support staking for some time.
                        const infiniteAllowance = `${10 ** 18}`;
                        for(let i = 0; i < 8; i++) {
                            await stakeTokenContract.methods.approve(
                                votingContract.options.address, infiniteAllowance
                            ).send({ ...txParams, from: accounts[i] });
                        }
                        // Note: No allowance set for account 8 =(
                    });

                    test('Should reject staking on proposals that do not exist', async () => {
                        expect(await reverts(
                            votingContract.methods.stake(1338, 1, true).send({ ...txParams }),
                            `VOTING_ERROR_PROPOSAL_DOES_NOT_EXIST`
                        )).toBe(true);
                    });

                    test('Should not allow an account to stake more tokens that it holds', async () => {
                        expect(await reverts(
                            votingContract.methods.stake(0, 1000, true).send({ ...txParams }),
                            `VOTING_ERROR_SENDER_DOES_NOT_HAVE_ENOUGH_FUNDS`
                        )).toBe(true);
                    });

                    test('Should not allow an account to stake without having provided sufficient allowance', async () => {
                        expect(await reverts(
                            votingContract.methods.stake(0, 10, true).send({ ...txParams, from: accounts[8] }),
                            `VOTING_ERROR_INSUFFICIENT_ALLOWANCE`
                        )).toBe(true);
                    });

                    test('Should not allow an account to withdraw tokens from a proposal that has no stake', async () => { expect(await reverts(
                            votingContract.methods.unstake(0, 10, true).send({ ...txParams }),
                            `VOTING_ERROR_SENDER_DOES_NOT_HAVE_REQUIRED_STAKE`
                        )).toBe(true);
                    });

                    test('Should not allow an account to withdraw tokens that were not staked by the account', async () => {
                        await votingContract.methods.stake(0, 1, true).send({ ...txParams });
                        expect(await reverts(
                            votingContract.methods.unstake(0, 1, true).send({ ...txParams, from: accounts[1] }),
                            `VOTING_ERROR_SENDER_DOES_NOT_HAVE_REQUIRED_STAKE`
                        )).toBe(true);
                    });

                    test('Can retrieve a proposals confidence factor', async () => {
                        await votingContract.methods.stake(0, 10, true).send({ ...txParams, from: accounts[3] });
                        await votingContract.methods.stake(0, 5, false).send({ ...txParams, from: accounts[4] });
                        expect(await votingContract.methods.getConfidence(0).call()).toBe(`${2 * PRECISION_MULTIPLIER}`);
                    });

                    test('Should allow staking and unstaking on proposals', async () => {
                        
                        // Stake tokens.
                        const upstakeReceipt = await votingContract.methods.stake(0, 10, true).send({ ...txParams, from: accounts[6] });
                        const downstakeReceipt = await votingContract.methods.stake(0, 5, false).send({ ...txParams, from: accounts[6] });

                        // Verify that the proper events were triggered.
                        let event = upstakeReceipt.events.UpstakeProposal;
                        expect(event).not.toBeNull();
                        expect(event.returnValues._proposalId).toBe(`0`);
                        expect(event.returnValues._staker).toBe(accounts[6]);
                        expect(event.returnValues._amount).toBe(`10`);
                        event = downstakeReceipt.events.DownstakeProposal;
                        expect(event).not.toBeNull();
                        expect(event.returnValues._proposalId).toBe(`0`);
                        expect(event.returnValues._staker).toBe(accounts[6]);
                        expect(event.returnValues._amount).toBe(`5`);

                        // Stake some more.
                        await votingContract.methods.stake(0, 5, true).send({ ...txParams, from: accounts[6] });
                        await votingContract.methods.stake(0, 5, false).send({ ...txParams, from: accounts[6] });

                        // Verify that the proposal received the stake.
                        const proposal = await votingContract.methods.getProposal(0).call();
                        expect(proposal.upstake).toBe(`15`);
                        expect(proposal.downstake).toBe(`10`);
     
                        // Verify that the proposal registers the sender's stake.
                        let upstake = await votingContract.methods.getUpstake(0, accounts[6]).call();
                        expect(upstake).toBe(`15`);
                        let downstake = await votingContract.methods.getDownstake(0, accounts[6]).call();
                        expect(downstake).toBe(`10`);
                        
                        // Verify that the owner's stake token balance decreased.
                        let stakerBalance = await stakeTokenContract.methods.balanceOf(accounts[6]).call();
                        expect(stakerBalance).toBe(`75`);

                        // Verify that the voting contract now holds the staked tokens.
                        let votingBalance = await stakeTokenContract.methods.balanceOf(votingContract.options.address).call();
                        expect(votingBalance).toBe(`25`);
                        
                        // Retrieve stake.
                        const unUpstakeReceipt = await votingContract.methods.unstake(0, 10, true).send({ ...txParams, from: accounts[6] });
                        const unDownstakeReceipt = await votingContract.methods.unstake(0, 5, false).send({ ...txParams, from: accounts[6] });

                        // Verify that the proper events were triggered.
                        event = unUpstakeReceipt.events.WithdrawUpstake;
                        expect(event).not.toBeNull();
                        expect(event.returnValues._proposalId).toBe(`0`);
                        expect(event.returnValues._staker).toBe(accounts[6]);
                        expect(event.returnValues._amount).toBe(`10`);
                        event = unDownstakeReceipt.events.WithdrawDownstake;
                        expect(event).not.toBeNull();
                        expect(event.returnValues._proposalId).toBe(`0`);
                        expect(event.returnValues._staker).toBe(accounts[6]);
                        expect(event.returnValues._amount).toBe(`5`);
                        
                        // Verify that the proposal registers the new sender's stake.
                        upstake = await votingContract.methods.getUpstake(0, accounts[6]).call();
                        expect(upstake).toBe(`5`);
                        downstake = await votingContract.methods.getDownstake(0, accounts[6]).call();
                        expect(downstake).toBe(`5`);
                        
                        // Verify that the staker retrieved the tokens.
                        stakerBalance = await stakeTokenContract.methods.balanceOf(accounts[6]).call();
                        expect(stakerBalance).toBe(`90`);

                        // Verify that the voting contract lost the tokens payed out to the staker.
                        votingBalance = await stakeTokenContract.methods.balanceOf(votingContract.options.address).call();
                        expect(votingBalance).toBe(`10`);
                    });

                    test.todo('External callers should not be able to boost a proposal that hasn\'t gained enough confidence');

                    describe('When proposals have enough confidence', () => {

                        beforeEach(async () => {
                            
                            // Stake enough to reach the confidence factor.
                            await votingContract.methods.stake(0, 40, true).send({ ...txParams, from: accounts[6] });
                            await votingContract.methods.stake(0, 10, false).send({ ...txParams, from: accounts[7] });
                        });

                        it('Their state should be set to Pended', async () => {

                            // Verify confidence.
                            const confidence = await votingContract.methods.getConfidence(0).call();
                            expect(confidence).toBe(`${4 * PRECISION_MULTIPLIER}`);

                            // Retrieve the proposal and verify it's state.
                            const proposal = await votingContract.methods.getProposal(0).call();
                            expect(proposal.state).toBe(`2`); // ProposalState '2' = Pended
                            const pendedDateDeltaSecs = ( new Date().getTime() / 1000 ) - parseInt(proposal.lastPendedDate, 10);
                            expect(pendedDateDeltaSecs).toBeLessThan(2);
                        }); 

                        it('Their state should change to Unpended if confidence drops', async () => {

                            // Downstake the proposal a bit to reduce confidence beneath the threshold.
                            await votingContract.methods.stake(0, 10, false).send({ ...txParams, from: accounts[7] });
                            
                            // Verify that confidence dropped.
                            const confidence = await votingContract.methods.getConfidence(0).call();
                            expect(confidence).toBe(`${2 * PRECISION_MULTIPLIER}`);

                            // Retrieve the proposal and verify it's state.
                            const proposal = await votingContract.methods.getProposal(0).call();
                            expect(proposal.state).toBe(`1`); // ProposalState '1' = Unpended
                            expect(proposal.lastPendedDate).toBe(`0`);
                        }); 

                        test.todo('External callers should not be able to boost a proposal that hasn\'t been pended for enough time');

                        describe('When proposals have had enough confidence for a while', () => {
                            
                            beforeEach(async () => {
                                
                                // Advance enough time for a proposal to be boosted.
                                await util.skipTime(PENDED_BOOST_PERIOD_SECS + 0.01 * HOURS);
                            });

                            test('An external caller should be able to boost the proposal and receive a compensation fee', async () => {

                                // Record the caller's current stake token balance
                                // to later verify that it has received a compensation fee for the call.
                                const balance = await stakeTokenContract.methods.balanceOf(accounts[0]).call();

                                // Boost the proposal.
                                await votingContract.methods.boostProposal(0).send({ ...txParams });

                                // Verify the proposal's state.
                                const proposal = await votingContract.methods.getProposal(0).call();
                                expect(proposal.state).toBe(`3`); // ProposalState '3' = Boosted
                                expect(proposal.lastPendedDate).toBe(`0`);

                                // Verify that the proposal's lifetime has changed to boostPeriod.
                                expect(proposal.lifetime).toBe(`${BOOST_PERIOD_SECS}`);

                                // Verify that the coller received a compensation fee.
                                const newBalance = await stakeTokenContract.methods.balanceOf(accounts[0]).call();
                                console.log(`newBalance`, newBalance);
                                expect(parseInt(newBalance, 10)).toBeGreaterThan(parseInt(balance, 10));
                            });

                            test.todo('An external caller shouldn\'t be able to boost a proposal once it has already been boosted');

                        }); // When proposals have had enough confidence for a while
                    }); // When proposals have enough confidence
                }); // When staking on proposals
            }); // When voting on proposals
        }); // When creating proposals
    }); // When setting up an HC contract correctly

    // TODO
    // describe('When setting up an HC contract incorrectly');
});